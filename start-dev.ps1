# AI-LifeOS local dev launcher.
#
# Why this exists: Node.js never reads the Windows WinINET proxy, so a plain
# `next dev` reaches the internet directly and OpenAI answers 403
# unsupported_country_region_territory. Edge works because it does read the
# system proxy. This script gives the Node process the same authorized network
# path before it starts, so the OAuth token exchange and the Responses API call
# leave from the expected egress.
#
# Scope: this only affects this process tree. It does not change the Windows
# global proxy, sing-box, the registry, or any other Node project. No proxy
# credential, token or private path is written here or committed.

param(
  [int]$Port = 3031,
  [string]$BindHost = '127.0.0.1',
  [switch]$Lan,
  [string]$LanIp = ''
)

$ErrorActionPreference = 'Stop'

# Always launch the app beside this script, even when PowerShell was opened
# from another directory.
Set-Location -LiteralPath $PSScriptRoot

function Test-PrivateIPv4 {
  param([string]$Address)

  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed)) { return $false }
  if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $octets = $Address.Split('.')
  if ($octets.Count -ne 4) { return $false }
  $numbers = @()
  foreach ($octet in $octets) {
    $number = 0
    if (-not [int]::TryParse($octet, [ref]$number)) { return $false }
    if ($number -lt 0 -or $number -gt 255) { return $false }
    $numbers += $number
  }
  if ($numbers[0] -eq 10) { return $true }
  if ($numbers[0] -eq 192 -and $numbers[1] -eq 168) { return $true }
  if ($numbers[0] -eq 172 -and $numbers[1] -ge 16 -and $numbers[1] -le 31) { return $true }
  return $false
}

# Windows stores firewall address filters as "192.168.3.0/255.255.255.0" while a
# launcher computes "192.168.3.0/24". Those are the same network, so compare the
# parsed network value and prefix length instead of the raw strings.
function ConvertTo-IPv4UInt32 {
  param([string]$Address)

  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed)) { return $null }
  if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $null }
  $bytes = $parsed.GetAddressBytes()
  return ([uint32]$bytes[0] -shl 24) -bor ([uint32]$bytes[1] -shl 16) -bor ([uint32]$bytes[2] -shl 8) -bor [uint32]$bytes[3]
}

# Parses "a.b.c.d", "a.b.c.d/nn" or "a.b.c.d/255.255.255.0" into a network object.
# Returns $null for "Any", wildcards, host names, IPv6 and non-contiguous masks.
function ConvertTo-IPv4Network {
  param([string]$Spec)

  if ([string]::IsNullOrWhiteSpace($Spec)) { return $null }
  $text = $Spec.Trim()
  $parts = $text.Split('/')
  if ($parts.Count -gt 2) { return $null }

  $addressValue = ConvertTo-IPv4UInt32 -Address $parts[0].Trim()
  if ($null -eq $addressValue) { return $null }

  $prefixLength = 32
  if ($parts.Count -eq 2) {
    $maskText = $parts[1].Trim()
    if ($maskText -match '^[0-9]{1,2}$') {
      $prefixLength = [int]$maskText
    } else {
      $maskValue = ConvertTo-IPv4UInt32 -Address $maskText
      if ($null -eq $maskValue) { return $null }
      $prefixLength = 0
      $zeroSeen = $false
      for ($bit = 31; $bit -ge 0; $bit--) {
        if ((($maskValue -shr $bit) -band 1) -eq 1) {
          if ($zeroSeen) { return $null }
          $prefixLength++
        } else {
          $zeroSeen = $true
        }
      }
    }
  }
  if ($prefixLength -lt 0 -or $prefixLength -gt 32) { return $null }

  $maskBytes = New-Object byte[] 4
  for ($index = 0; $index -lt 4; $index++) {
    $bits = $prefixLength - ($index * 8)
    if ($bits -ge 8) { $maskBytes[$index] = 255 }
    elseif ($bits -le 0) { $maskBytes[$index] = 0 }
    else { $maskBytes[$index] = [byte]((([int]255) -shl (8 - $bits)) -band 255) }
  }
  $maskTotal = ([uint32]$maskBytes[0] -shl 24) -bor ([uint32]$maskBytes[1] -shl 16) -bor ([uint32]$maskBytes[2] -shl 8) -bor [uint32]$maskBytes[3]

  return [pscustomobject]@{
    Address      = $parts[0].Trim()
    PrefixLength = $prefixLength
    Network      = [uint32]($addressValue -band $maskTotal)
    Mask         = [uint32]$maskTotal
  }
}

function Test-IPv4NetworkEqual {
  param([string]$Left, [string]$Right)

  $first = ConvertTo-IPv4Network -Spec $Left
  $second = ConvertTo-IPv4Network -Spec $Right
  if ($null -eq $first -or $null -eq $second) { return $false }
  return ($first.PrefixLength -eq $second.PrefixLength) -and ($first.Network -eq $second.Network)
}

# True when $Candidate is the same network as, or a narrower subnet of, $Container.
function Test-IPv4NetworkWithin {
  param([string]$Candidate, [string]$Container)

  $inner = ConvertTo-IPv4Network -Spec $Candidate
  $outer = ConvertTo-IPv4Network -Spec $Container
  if ($null -eq $inner -or $null -eq $outer) { return $false }
  if ($inner.PrefixLength -lt $outer.PrefixLength) { return $false }
  return ([uint32]($inner.Network -band $outer.Mask) -eq [uint32]$outer.Network)
}

function Get-ActivePrivateIPv4 {
  if (-not (Get-Command Get-NetRoute -ErrorAction SilentlyContinue)) {
    throw 'Get-NetRoute is unavailable. Verify that the Windows NetTCPIP module is installed.'
  }
  if (-not (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue)) {
    throw 'Get-NetIPAddress is unavailable. Verify that the Windows NetTCPIP module is installed.'
  }

  $routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop)
  if ($routes.Count -eq 0) {
    throw 'No IPv4 default route was found. Connect this computer to the same Wi-Fi and retry.'
  }
  $route = $routes | Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1

  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction Stop |
    Where-Object {
      $_.AddressState -eq 'Preferred' -and
      -not $_.SkipAsSource -and
      (Test-PrivateIPv4 -Address $_.IPAddress)
    })
  if ($addresses.Count -eq 0) {
    throw "The default-route adapter ($($route.InterfaceAlias)) has no usable private IPv4 address. Connect it to the same Wi-Fi and retry."
  }
  if ($addresses.Count -gt 1) {
    $choices = ($addresses | ForEach-Object { $_.IPAddress }) -join ', '
    throw "The default-route adapter has multiple private IPv4 addresses: $choices. Choose the phone-accessible address explicitly with -LanIp."
  }
  return [string]$addresses[0].IPAddress
}

$lanAccessKey = ''
$privateIp = ''
if ($Lan) {
  $BindHost = '0.0.0.0'
  if ($LanIp) {
    if (-not (Test-PrivateIPv4 -Address $LanIp)) {
      Write-Error "-LanIp must be a private IPv4 address on an active local adapter. Received: $LanIp"
      exit 1
    }
    if (-not (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue)) {
      Write-Error "-LanIp cannot be verified because Get-NetIPAddress is unavailable."
      exit 1
    }
    $localMatch = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $LanIp -ErrorAction SilentlyContinue |
      Where-Object { $_.AddressState -eq 'Preferred' -and -not $_.SkipAsSource }
    if (-not $localMatch) {
      Write-Error "-LanIp is not an active local IPv4 address. Received: $LanIp"
      exit 1
    }
    $privateIp = $LanIp
  } else {
    $privateIp = Get-ActivePrivateIPv4
  }
  if (-not $privateIp) {
    Write-Error 'No usable private LAN IPv4 address was found. Connect this computer to the same Wi-Fi and retry.'
    exit 1
  }

  $bytes = New-Object byte[] 8
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $lanAccessKey = ([BitConverter]::ToString($bytes)).Replace('-', '')
  $env:AIOS_LAN_ACCESS_KEY = $lanAccessKey
  $env:AIOS_ALLOWED_DEV_ORIGIN = $privateIp
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $privateIp -ErrorAction SilentlyContinue |
    Where-Object { $_.AddressState -eq 'Preferred' -and -not $_.SkipAsSource })
  if ($addresses.Count -eq 0) {
    Write-Error "The LAN address is not active. Received: $privateIp"
    exit 1
  }
  $prefixLength = [int]$addresses[0].PrefixLength
  if ($prefixLength -lt 24 -or $prefixLength -gt 30) {
    Write-Error "Refusing LAN mode for an unusually broad /$prefixLength subnet. Use a normal home or office Wi-Fi subnet."
    exit 1
  }
  $addressBytes = [Net.IPAddress]::Parse($privateIp).GetAddressBytes()
  $networkBytes = New-Object byte[] 4
  $remainingBits = [int]$prefixLength
  for ($index = 0; $index -lt 4; $index++) {
    if ($remainingBits -ge 8) {
      $networkBytes[$index] = $addressBytes[$index]
      $remainingBits -= 8
    } elseif ($remainingBits -gt 0) {
      $mask = (256 - [math]::Pow(2, 8 - $remainingBits))
      $networkBytes[$index] = [byte]($addressBytes[$index] -band [int]$mask)
      $remainingBits = 0
    } else {
      $networkBytes[$index] = 0
    }
  }
  $networkAddress = (New-Object Net.IPAddress(,$networkBytes)).ToString()
  $remoteRange = "$networkAddress/$prefixLength"
  $env:AIOS_LAN_REMOTE_RANGE = $remoteRange
  $firewallName = "AI-LifeOS LAN $Port"
  $firewallRules = @(Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue)
  if ($env:AIOS_LAUNCHER_VERIFY_ONLY -ne '1' -and $env:AIOS_LAUNCHER_FIREWALL_PREPARED -ne '1') {
    if ($firewallRules.Count -eq 0) {
      $createdRule = New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -LocalAddress $privateIp -RemoteAddress $remoteRange -Profile Private -Description 'AI-LifeOS private Wi-Fi access only; loopback and public access excluded.' -ErrorAction SilentlyContinue
      $firewallRules = @($createdRule | Where-Object { $_ })
    }
    if ($firewallRules.Count -eq 0) {
      Write-Host ''
      Write-Host "Windows Firewall has no rule for TCP $Port. Run this exact command once in an elevated Windows PowerShell, then rerun the LAN launcher:" -ForegroundColor Yellow
      Write-Host "  New-NetFirewallRule -DisplayName '$firewallName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -LocalAddress '$privateIp' -RemoteAddress '$remoteRange' -Profile Private" -ForegroundColor Yellow
      exit 1
    }

    $firewallProblems = @()
    foreach ($rule in $firewallRules) {
      $ruleLabel = "$firewallName (rule '$($rule.Name)')"

      if ([string]$rule.Enabled -ne 'True') {
        $firewallProblems += "$ruleLabel is not enabled (Enabled=$([string]$rule.Enabled))."
      }
      if ([string]$rule.Direction -ne 'Inbound') {
        $firewallProblems += "$ruleLabel has Direction=$([string]$rule.Direction), expected Inbound."
      }
      if ([string]$rule.Action -ne 'Allow') {
        $firewallProblems += "$ruleLabel has Action=$([string]$rule.Action), expected Allow."
      }
      $profileNames = @(@($rule.Profile) | ForEach-Object { [string]$_ } | Where-Object { $_ })
      if ($profileNames.Count -ne 1 -or $profileNames[0] -ne 'Private') {
        $firewallProblems += "$ruleLabel has Profile='$($profileNames -join ',')', expected Private only."
      }

      $portFilters = @($rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue)
      $protocolOk = $false
      $localPorts = @()
      foreach ($portFilter in $portFilters) {
        if ([string]$portFilter.Protocol -eq 'TCP') { $protocolOk = $true }
        foreach ($portEntry in @($portFilter.LocalPort)) { $localPorts += ([string]$portEntry).Trim() }
      }
      if (-not $protocolOk) {
        $firewallProblems += "$ruleLabel does not use Protocol=TCP."
      }
      $portOk = ($localPorts.Count -ge 1)
      foreach ($portEntry in $localPorts) {
        if ($portEntry -notmatch '^[0-9]+$' -or [int]$portEntry -ne $Port) { $portOk = $false }
      }
      if (-not $portOk) {
        $firewallProblems += "$ruleLabel has LocalPort='$($localPorts -join ',')', expected exactly $Port."
      }

      $addressFilters = @($rule | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue)
      $localAddresses = @()
      $remoteAddresses = @()
      foreach ($addressFilter in $addressFilters) {
        foreach ($addressEntry in @($addressFilter.LocalAddress)) { $localAddresses += ([string]$addressEntry).Trim() }
        foreach ($addressEntry in @($addressFilter.RemoteAddress)) { $remoteAddresses += ([string]$addressEntry).Trim() }
      }
      $localAddresses = @($localAddresses | Where-Object { $_ })
      $remoteAddresses = @($remoteAddresses | Where-Object { $_ })

      $localOk = ($localAddresses.Count -ge 1)
      foreach ($addressEntry in $localAddresses) {
        if (-not (Test-IPv4NetworkEqual -Left $addressEntry -Right $privateIp)) { $localOk = $false }
      }
      if (-not $localOk) {
        $firewallProblems += "$ruleLabel has LocalAddress='$($localAddresses -join ',')', expected exactly $privateIp."
      }

      $remoteOk = ($remoteAddresses.Count -ge 1)
      $remoteExact = $false
      foreach ($addressEntry in $remoteAddresses) {
        if (-not (Test-IPv4NetworkWithin -Candidate $addressEntry -Container $remoteRange)) { $remoteOk = $false }
        if (Test-IPv4NetworkEqual -Left $addressEntry -Right $remoteRange) { $remoteExact = $true }
      }
      if (-not $remoteOk -or -not $remoteExact) {
        $firewallProblems += "$ruleLabel has RemoteAddress='$($remoteAddresses -join ',')', expected $remoteRange (same network address and same prefix length)."
      }
    }

    if ($firewallProblems.Count -gt 0) {
      Write-Host ''
      Write-Host "Windows Firewall rule '$firewallName' does not match the LAN requirement:" -ForegroundColor Yellow
      foreach ($firewallProblem in $firewallProblems) { Write-Host "  - $firewallProblem" -ForegroundColor Yellow }
      Write-Host 'Replace it with these exact commands in an elevated Windows PowerShell, then rerun the LAN launcher:' -ForegroundColor Yellow
      Write-Host "  Remove-NetFirewallRule -DisplayName '$firewallName'" -ForegroundColor Yellow
      Write-Host "  New-NetFirewallRule -DisplayName '$firewallName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -LocalAddress '$privateIp' -RemoteAddress '$remoteRange' -Profile Private" -ForegroundColor Yellow
      exit 1
    }
    $firewallReady = $true
  } else {
    $firewallReady = $true
  }
} else {
  Remove-Item Env:AIOS_LAN_ACCESS_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:AIOS_ALLOWED_DEV_ORIGIN -ErrorAction SilentlyContinue
  Remove-Item Env:AIOS_LAN_REMOTE_RANGE -ErrorAction SilentlyContinue
}

# The authorized local proxy entry point. Port 10808 accepts HTTP CONNECT.
$proxy = 'http://127.0.0.1:10808'

# Node 24 reads these only when NODE_USE_ENV_PROXY is set before the process
# starts. Changing them on a running process has no effect.
$env:NODE_USE_ENV_PROXY = '1'
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:ALL_PROXY = $proxy
# The OAuth callback listener must stay on loopback, never through the proxy.
$env:NO_PROXY = 'localhost,127.0.0.1,::1'

# Fail fast with a clear message instead of a confusing 403 later.
$proxyClient = New-Object Net.Sockets.TcpClient
try {
  $proxyConnect = $proxyClient.BeginConnect('127.0.0.1', 10808, $null, $null)
  if (-not $proxyConnect.AsyncWaitHandle.WaitOne(3000, $false)) {
    throw 'connection timed out'
  }
  $proxyClient.EndConnect($proxyConnect)
} catch {
  Write-Error "Proxy $proxy is not listening. Start the authorized proxy first, then rerun this script."
  exit 1
} finally {
  $proxyClient.Close()
}

# Verify the exact Node.js network path before starting OAuth-capable routes.
# This request carries no credential. OpenAI returns 401 when the API host is
# reachable through an accepted route; a region 403 or network failure stops
# startup before the user is asked to authorize again.
$openAiStatus = & node -e "fetch('https://api.openai.com/v1/models',{headers:{Accept:'application/json'}}).then(response=>{console.log(response.status);process.exit(response.status===401?0:1)}).catch(error=>{console.error(error.cause?.code||error.code||error.message);process.exit(2)})"
if ($LASTEXITCODE -ne 0) {
  Write-Error "OpenAI network preflight failed (HTTP/status: $openAiStatus). The dev server was not started. Check the authorized proxy route."
  exit 1
}

Write-Output "AI-LifeOS dev server"
if ($Lan) {
  Write-Output "  mode     : LAN (private Wi-Fi only)"
  Write-Output "  url      : http://$privateIp`:$Port/"
  Write-Output "  local    : http://127.0.0.1:$Port/"
  Write-Output "  access   : $lanAccessKey"
  Write-Output "  firewall : $firewallName (TCP $Port, $remoteRange, Private profile only)"
  Write-Output "  note     : On the phone, enter the LAN access code shown above."
} else {
  Write-Output "  mode     : local only"
  Write-Output "  url      : http://$BindHost`:$Port/"
}
Write-Output "  proxy    : $proxy (process scope only)"
Write-Output "  no_proxy : $env:NO_PROXY"
Write-Output "  openai   : reachable without credentials (HTTP $openAiStatus expected)"
Write-Output ""

if ($env:AIOS_LAUNCHER_VERIFY_ONLY -eq '1') {
  Write-Output '  verify   : launch checks passed; Next.js was not started'
  exit 0
}

npx next dev -p $Port -H $BindHost
