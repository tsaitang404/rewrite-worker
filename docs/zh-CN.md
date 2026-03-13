# rewrite-worker 中文文档

rewrite-worker 是一个 Cloudflare Worker，用于按规则改写请求的目标源站（hostname / port / path），也支持按规则做重定向。

## 功能概览

- 按 `hostname`、`path`（支持 `*` 通配符）匹配请求
- 改写目标 `hostname`、`port`、`path`
- 支持通配符捕获并在改写路径中复用
- 支持直接返回 HTTP 重定向（301/302/307/308）
- 规则按顺序匹配，命中第一条即生效

## 配置方式

通过环境变量 `REWRITE_RULES` 传入 JSON 数组。

### 规则结构

```jsonc
[
  {
    "match": {
      "hostname": "www.example.com", // 可选，精确匹配
      "path": "/*"                   // 可选，路径匹配（支持 *）
    },
    "redirect": {
      "location": "/Index",         // 必填，可为绝对 URL 或站内路径
      "status": 302                   // 可选，默认 302
    }
  },
  {
    "match": {
      "hostname": "www.example.com",
      "path": "/*"
    },
    "rewrite": {
      "hostname": "backend.example.net", // 可选
      "port": 8443,                        // 可选
      "path": "/share/*"                  // 可选
    }
  }
]
```

说明：

- `match` 字段都可省略；都省略时表示匹配所有请求
- `rewrite` 与 `redirect` 都是可选字段
- 同一条规则里若同时配置了 `redirect` 和 `rewrite`，会优先执行 `redirect`
- `match.path` 的 `*` 捕获内容可在 `rewrite.path` 或 `redirect.location` 中用 `*` 复用

## 常见场景

### 1. 裸路径跳转到 /Index

```json
[
  {
    "match": { "hostname": "www.example.com", "path": "/" },
    "redirect": { "location": "/Index", "status": 302 }
  },
  {
    "match": { "hostname": "www.example.com", "path": "/*" },
    "rewrite": { "hostname": "backend.example.net", "path": "/share/*" }
  }
]
```

### 2. 根域统一跳转到 www

```json
[
  {
    "match": { "hostname": "example.com", "path": "/" },
    "redirect": { "location": "https://www.example.com/Index", "status": 301 }
  },
  {
    "match": { "hostname": "example.com", "path": "/*" },
    "rewrite": { "hostname": "backend.example.net", "path": "/share/*" }
  }
]
```

## 本地开发

```bash
npm install
cp .env.example .env
cp .dev.vars.example .dev.vars
npm run dev
```

测试与检查：

```bash
npm test
npm run type-check
```

## GitHub Actions 部署

项目内置工作流：`.github/workflows/deploy-worker.yml`

需要在 GitHub 仓库中配置：

- Secrets
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- Variables
  - `REWRITE_RULES_JSON`
  - `WORKER_ROUTES`
  - `WORKER_ZONE_NAME`

`WORKER_ROUTES` 支持多行，一行一个路由。
