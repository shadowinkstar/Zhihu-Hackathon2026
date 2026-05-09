# 狗尾续貂？

知乎 Hackathon 2026「AI 脑洞实验室」创作赛道 Demo。项目定位是一个面向知乎长文、盐选题材和用户自有草稿的 AI 续写工作台：识别文章断口，炼化可审计的文风 Skill，再生成带版权声明的原创续写草稿。

## 技术栈

- Next.js App Router + TypeScript
- Tailwind CSS v4
- Route Handlers 作为后端 API
- `framer-motion` 做轻量交互动效
- `lucide-react` 做操作图标
- 本地 JSON 邀请码限额存储，后续可替换为 Postgres/Redis

## 本地运行

```bash
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

## 核心功能

- 文章输入：支持知乎链接、用户粘贴片段、自有草稿和授权文本声明。
- 风格炼化：生成 `dogtail-style.skill` 摘要，包含节奏、词汇、桥段和禁区。
- 续写生成：支持邀请码额度模型，也支持用户登记 OpenAI-compatible API。
- 版权护栏：默认禁止绕过付费墙、复现隐藏正文、冒充原作者。
- 主页声明：生成用户主页预览、AI 辅助声明、原文跳转和下架入口。

## API

### `POST /api/analyze`

抽取公开元信息、用户片段和风格 Skill。

```json
{
  "sourceUrl": "https://www.zhihu.com/question/...",
  "sourceText": "用户有权提供的片段",
  "permission": "public"
}
```

### `POST /api/generate`

基于分析结果生成续写。邀请码模式会扣减本地额度。

```json
{
  "analysis": {},
  "sourceText": "用户有权提供的片段",
  "selectedArc": "付费断口安全续写",
  "length": "medium",
  "styleIntensity": 56,
  "access": {
    "mode": "invite",
    "inviteCode": "ZH-HACK-2026"
  }
}
```

### `POST /api/invite/redeem`

检查或扣减邀请码额度。

```json
{
  "code": "ZH-HACK-2026",
  "previewOnly": true
}
```

## 调用日志

每次分析、炼化和生成都会写入结构化 JSONL：

```text
data/call-logs/YYYY-MM-DD.jsonl
```

日志会记录：

- `promptVersion`
- 请求摘要和文本哈希
- system prompt、用户 prompt 模板、正文片段哈希和短预览
- 模型供应商、模型名、耗时
- 模型 token usage、停止原因、返回 content block 类型
- 输出全文和输出摘要
- 失败原因和回退路径

不会记录 API Key；用户粘贴的盐选/付费正文不会以全文写入日志。查看最新日志摘要：

```bash
npm run logs:latest
```

## 内置模型配置

邀请码模式会按顺序尝试：

1. Anthropic/Claude-compatible 环境变量
2. OpenAI-compatible 内置接口
3. 本地 mock 文本

```bash
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-5
```

或配置 OpenAI-compatible 接口：

```bash
INTERNAL_MODEL_ENDPOINT=https://api.example.com/v1
INTERNAL_MODEL_API_KEY=sk-...
INTERNAL_MODEL_NAME=your-model-name
```

本机已有 Claude Code 相关环境时，也会识别 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_DEFAULT_SONNET_MODEL` 和 `ANTHROPIC_DEFAULT_HAIKU_MODEL`。未配置真实模型时，邀请码模式会返回稳定的本地 mock 续写，便于现场演示。

## 邀请码

默认邀请码在 `src/lib/server/invite-store.ts` 中配置：

- `ZH-HACK-2026`：20 次
- `DOGTAIL-DEMO`：8 次

运行时会自动生成 `data/invites.json` 保存使用量。该文件已加入 `.gitignore`。

## 后续扩展

- 接入知乎官方开放 API，替换当前公开标题抓取和文本粘贴流程。
- 将 Skill 导出为标准 `SKILL.md` 文件夹，沉淀作者/题材协作模板。
- 增加多 Agent 审稿流：剧情架构师、文风编辑、版权哨兵、发布助理。
- 自动生成 LoRA/SFT 数据集，只允许使用自有或授权语料。
- 增加账号系统和作品广场，用于人气奖曝光与项目广场占位。
