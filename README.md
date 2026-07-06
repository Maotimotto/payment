# 账单 · 个人记账

纯本地、隐私优先、可选接入大模型的小而美个人记账 Web 应用。数据全部存储在浏览器 IndexedDB，无后端、无账号、不上云。

## 功能

- **多账本**：单用户、多账本切换管理。
- **账单导入**：
  - CSV：内置微信 / 支付宝 / 招商银行 规则解析；其他格式在接入大模型后由 LLM 解析。
  - 截图：接入大模型后，多模态识别账单截图。
  - 手动录入：单笔录入。
- **智能分类**：商户记忆 → 大模型分批分类（50 条/批，失败降级本地规则）→ 关键词规则。
- **跨平台去重**：双窗口（普通消费 ≤10s / 还款转账类 ≤24h），标记疑似重复，用户一键确认合并。
- **组合支付**：保留多笔并分组标注，不去重。
- **多级标签**：预设 + 自定义增删；资金搬运类（信用卡还款/转账）不计入收支统计。
- **可视化**：当月收支卡片、分类饼图、近 6 月趋势、支付渠道占比、账本对比、支出 Top10、消费日历热力图。
- **导出**：导出 Excel。
- **暗色模式**。

## 技术栈

Vite + React + TypeScript + Tailwind CSS · IndexedDB（Dexie）· Zustand · Recharts · PapaParse · SheetJS。

## 开发

### 环境准备

项目不提交 `node_modules/` 和 `dist/`，clone 后需要先安装依赖：

```bash
git clone <repo-url>
cd payment
npm install       # 安装依赖，生成 node_modules/
```

### 启动开发服务

```bash
npm run dev       # 本地开发 http://localhost:5173
```

### 构建

```bash
npm run build     # 类型检查 + 生产构建，输出到 dist/
npm run preview   # 预览构建产物
```

### 视频媒体

`public/media/` 下的 mp4 文件（~333M）已纳入 Git 版本管理，clone 时自动下载。

媒体相关脚本：

```bash
npm run media:serve      # 启动静态媒体服务（用于本地媒体文件托管）
npm run media:transcode  # 重新转码媒体文件
```

如需将视频托管到 CDN 以减小仓库体积，设置环境变量：

```bash
VITE_LIFE_MEDIA_BASE=https://your-cdn.example.com/media
```

## 大模型配置

在「设置」页填写 API Key、Base URL（OpenAI 兼容接口）、模型名，并可测试连接。Key 仅存于本地浏览器，未加密，请勿在公共设备保存。

## 说明

详细需求与决策见 `PRD.md`。
