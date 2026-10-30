import { redirect } from 'next/navigation'

// Local single-user release: create a test account in your own Firebase console.
export default function SignupDisabled() {
  redirect('/')
}
