type FlowStatus = 'idle' | 'working' | 'done' | 'error'

type FlowMotionProps = {
  className?: string
  status?: FlowStatus
  variant?: 'empty' | 'import'
}

const statusText: Record<FlowStatus, string> = {
  idle: '待导入',
  working: '清洗中',
  done: '已入账',
  error: '待确认',
}

export function FlowMotion({ className = '', status = 'idle', variant = 'empty' }: FlowMotionProps) {
  return (
    <div
      className={`flow-scene flow-scene-${variant} flow-status-${status} ${className}`}
      role="img"
      aria-label="多来源流水汇入汐账本地账本的示意动画"
    >
      <svg viewBox="0 0 520 300">
        <path className="flow-orbit flow-orbit-one" d="M78 82 C165 66 220 122 276 150" />
        <path className="flow-orbit flow-orbit-two" d="M70 208 C154 228 213 184 276 150" />
        <path className="flow-orbit flow-orbit-three" d="M120 145 C176 145 222 145 276 150" />
        <path className="flow-orbit flow-orbit-four" d="M94 262 C178 270 232 223 286 177" />

        <g className="flow-node flow-node-a">
          <rect x="30" y="48" width="100" height="52" rx="8" />
          <text x="80" y="79">微信</text>
        </g>
        <g className="flow-node flow-node-b">
          <rect x="24" y="184" width="112" height="52" rx="8" />
          <text x="80" y="215">支付宝</text>
        </g>
        <g className="flow-node flow-node-c">
          <rect x="42" y="120" width="104" height="52" rx="8" />
          <text x="94" y="151">银行</text>
        </g>
        <g className="flow-node flow-node-d">
          <rect x="66" y="244" width="92" height="42" rx="8" />
          <text x="112" y="270">截图</text>
        </g>

        <g className="flow-ledger">
          <rect className="flow-ledger-shadow" x="292" y="42" width="148" height="206" rx="10" />
          <rect className="flow-ledger-body" x="280" y="34" width="148" height="206" rx="10" />
          <path className="flow-ledger-rule" d="M316 64v145M356 58v153M396 64v145" />
          <path className="flow-ledger-wave" d="M304 103c16-15 32-15 48 0s32 15 48 0" />
          <path className="flow-ledger-wave flow-ledger-wave-soft" d="M304 139c16 13 32 13 48 0s32-13 48 0" />
          <path className="flow-ledger-line" d="M306 176h92M306 199h70" />
          <circle className="flow-status-dot" cx="406" cy="60" r="7" />
          <text className="flow-ledger-title" x="354" y="228">汐账</text>
          <text className="flow-ledger-status" x="406" y="84">
            {statusText[status]}
          </text>
        </g>
      </svg>
    </div>
  )
}
