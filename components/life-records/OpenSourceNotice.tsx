/**
 * 「我的」页的开源与致谢区块。
 *
 * 合规要求：向用户显著展示 LifeTracker 来源、AGPL-3.0 许可证、Life OS 的 MIT
 * 通知，并明确 AI-LifeOS 是独立二次开发项目，与原作者无官方合作或背书关系。
 */

const LIFE_TRACKER_URL = 'https://github.com/ashishworkacc/life-tracker'
const LIFE_OS_URL = 'https://github.com/karim-coder/life-os'

const LIFE_OS_MIT_TEXT = `MIT License

Copyright (c) 2026 Life OS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

export default function OpenSourceNotice() {
  return (
    <section className="card space-y-3">
      <h3 className="font-bold">开源与致谢</h3>

      <p className="text-sm leading-6 text-muted">
        AI-LifeOS 是基于开源项目 <strong className="text-slate-200">LifeTracker</strong> 的二次开发项目，
        感谢原作者及上游贡献者的工作。AI-LifeOS 是独立项目，不隶属于 LifeTracker 原作者，
        也未获得其官方认可或授权背书。
      </p>

      <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm">
        <span className="text-muted">上游项目</span>
        <a href={LIFE_TRACKER_URL} target="_blank" rel="noreferrer noopener" className="text-cyan-300 underline underline-offset-2">
          ashishworkacc/life-tracker
        </a>
      </div>
      <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm">
        <span className="text-muted">上游许可证</span>
        <strong>GNU AGPL v3.0</strong>
      </div>
      <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm">
        <span className="text-muted">设计参考</span>
        <a href={LIFE_OS_URL} target="_blank" rel="noreferrer noopener" className="text-cyan-300 underline underline-offset-2">
          karim-coder/life-os
        </a>
      </div>

      <p className="text-xs leading-5 text-muted">
        仪表盘圆环的视觉实现参考 Life OS（MIT 许可）的 Dashboard 与 Focus 视图，并结合 LifeTracker 原有进度圆环重新实现。
        本项目仅参考其界面思路，未复制其他模块。
      </p>

      <details className="rounded-xl border border-cyan-300/20 bg-[#0c1a2e] p-3">
        <summary className="cursor-pointer text-xs font-semibold text-cyan-200">查看第三方许可证（Life OS · MIT）</summary>
        <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted">
          {LIFE_OS_MIT_TEXT}
        </pre>
      </details>

      <p className="text-xs leading-5 text-muted">
        完整 AGPL-3.0 许可证全文见代码仓库根目录 LICENSE。
      </p>

      <div className="flex justify-between gap-3 border-t border-cyan-300/15 pt-3 text-sm">
        <span className="text-muted">源代码与许可证</span>
        <a href="/source" className="text-cyan-300 underline underline-offset-2">
          查看当前版本来源与源码状态
        </a>
      </div>
    </section>
  )
}
