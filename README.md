# 狗尾续貂？

一个专门给知乎故事“续命”的 AI 创作工作台。

我想做的不是通用写作助手，而是一个更贴近知乎故事创作场景的工具：用户选择一段自己感兴趣的内容，或者粘贴一段自己已经能看到的文本，系统先炼化文风、梳理断口和剧情钩子，再生成一版可继续编辑的续写草稿。

- 在线演示：http://43.167.247.155:3000/
- 项目想法：[任瑄的想法 - 知乎](https://www.zhihu.com/pin/2038196230724007681)
- 参赛方向：知乎 Hackathon 2026「AI 脑洞实验室」

## 为什么做

知乎故事最有意思的地方，往往不是“让 AI 直接写一篇小说”，而是断在一个很会吊人的地方：人物关系刚刚立住，矛盾刚刚展开，读者已经开始脑补后续。

“狗尾续貂？”围绕这个瞬间做了三件事：

- 读懂材料：识别当前片段里的角色、冲突、断口和可续写方向。
- 炼化文风：从粘贴文本、公开材料或 Skill 链接中生成可复用的文风 Skill。
- 接着写下去：用当前文风和剧情方向生成续写，并保留工作记录、推理流和历史草稿。

## 当前能力

- **知乎登录**：登录后使用内置 Kimi 兼容模型配置。
- **故事选择**：接入 Hackathon 官方故事接口，可以从故事列表选择正文进入工作台。
- **文本续写**：支持用户粘贴已可见文本，选择文风、篇幅和生成模式后流式生成。
- **文风炼化**：支持粘贴多段材料，也支持从 ClawHub / GitHub Skill 导入材料，再生成自己的文风 Skill。
- **两档生成**：快速模式直接出稿；专家模式会按大纲、草稿、编辑校对流程推进。
- **过程可见**：页面展示阶段日志、实时正文、可选模型思考和历史记录。
- **部署预热**：部署脚本会在服务启动后预热 Claude Code daemon，避免首位用户承担冷启动。

## 产品流程

```mermaid
flowchart LR
  A["选择故事或粘贴片段"] --> B["分析断口与剧情钩子"]
  B --> C["选择或炼化文风 Skill"]
  C --> D["配置篇幅与模式"]
  D --> E["Claude Code 流式生成"]
  E --> F["继续生成或回看历史"]
```

## 技术栈

- Next.js App Router + TypeScript
- Tailwind CSS v4
- Route Handlers 作为后端 API
- Claude Code 常驻进程 + `stream-json` 事件流
- 本地 JSON 存储用户、会话、文风和生成记录
- `framer-motion` + `lucide-react` 做轻量交互

## 本地运行

```bash
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

需要在 `.env.local` 中配置知乎 OAuth 和模型相关环境变量。当前项目使用 repo-local Claude Code / Kimi 兼容配置，避免修改全局模型配置。

## 关键接口

### `GET /api/me`

读取当前登录用户、用户文风和历史生成记录。未登录时返回空用户，方便前端安静探测登录状态。

### `GET /api/stories`

读取 Hackathon 官方故事列表。

### `GET /api/stories/[workId]`

读取单个故事详情，并放入续写工作台。

### `POST /api/style-refine`

基于用户提供的材料生成文风 Skill，返回 Server-Sent Events。

### `POST /api/generate/stream`

登录后的内置模型流式续写接口。请求示例：

```json
{
  "analysis": {},
  "sourceText": "用户已经能看到并选择提供的片段",
  "selectedArc": "续写",
  "generationMode": "quick",
  "thinkingEnabled": false,
  "length": "medium",
  "styleIntensity": 64,
  "access": {
    "mode": "internal"
  }
}
```

响应是 Server-Sent Events：

```text
event: log
data: {"type":"log","title":"等待模型返回","status":"running"}

event: text
data: {"type":"text","chunk":"..."}
```

### `GET /api/generate/stream?warm=1&wait=1`

部署阶段使用的 Claude Code daemon 预热接口。普通页面不会自动调用它。

## 部署

服务器上直接运行：

```bash
APP_PORT=3000 DEPLOY_BRANCH=master bash scripts/deploy-server.sh
```

部署脚本会完成：

- 拉取最新代码
- 安装依赖
- 构建 `.next-build`
- 停止旧进程
- 启动固定端口服务
- 校验 `/api/me` 和 `/api/auth/zhihu/start`
- 预热 Claude Code daemon

如果临时不想在部署阶段等待预热：

```bash
PREWARM_CLAUDE=0 bash scripts/deploy-server.sh
```

## 调用日志

分析、炼化和生成会写入结构化 JSONL：

```text
data/call-logs/YYYY-MM-DD.jsonl
```

日志记录模型供应商、耗时、prompt 版本、请求摘要、输出摘要和失败原因；不会记录 API Key。

查看最新日志摘要：

```bash
npm run logs:latest
```

## 边界

这个项目只处理用户已经能合法看到、选择或粘贴提供的内容。它不会绕过登录、付费墙或平台限制，也不会把“模仿真实作者”作为产品目标。文风炼化服务于续写协作，最终输出仍然需要用户编辑、判断和发布。
