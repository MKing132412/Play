# 谜局 Mystery DM

面向异地剧本杀的可运行 MVP：网站管理剧本、角色、阶段、线索和投票，玩家通过外部语音交流，DeepSeek AI DM 负责文字主持与私人问答。

## 启动

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

不配置 `DEEPSEEK_API_KEY` 时，导入页会明确标识并使用内置《游轮迷影》演示数据，AI DM 使用规则化本地回答；配置后，导入接口分批分析 PDF/JPG/PNG，AI DM 使用服务端生成的当前玩家可见上下文回答。`DEEPSEEK_MODEL` 使用 Responses API 负责 DM 与汇总，`DEEPSEEK_VISION_MODEL` 使用 Chat Completions 负责扫描图识别。PDF 会在服务端临时转换成页面图片，不保留中间文件。

目录导入会递归读取文件，过滤推广文件，并在同名 PDF 已存在时忽略重复的分页 JPG。解析过程以流式事件显示当前文件和页码。线索扫描图按图中的实体卡逐张提取，而不是按图片数量计算；每条线索会记录来源扫描图，供审核台逐卡修改、补录或删除。

## 剧本库

- 导入完成后，结构化剧本持久化到 `data/scripts/`；刷新、换浏览器或服务重启后仍可打开。
- 每次导入按相对路径和文件内容计算 SHA-256。完全相同的文件直接复用已有解析，不重复调用 AI。
- 同名目录内容发生变化时保存为新版本，旧版本和已经创建的房间不受影响。
- 审核台修改自动写回当前版本；删除剧本库版本不会删除已经创建的房间。
- 当前文件存储适合单机 Docker/VPS 部署，需把 `data/` 挂载为持久卷；多实例部署时替换为 PostgreSQL 和对象存储。

### 服务器持久化

生产环境把以下两个目录放在持久化磁盘上，并在服务重启或重新部署时保留原目录：

```env
SCRIPT_DATA_DIR=/srv/mystery-dm/data/scripts
ROOM_DATA_DIR=/srv/mystery-dm/data/rooms
```

首次部署时将现有 `data/scripts/` 一并复制到服务器；`data/rooms/` 用于保存进行中的房间、线索和投票状态。更新代码时只替换应用代码和 `.next/`，不要删除这两个目录。启动前执行 `npm run build`，运行时执行 `npm run start`。

## 异地房间

- 审核通过后自动创建服务端房间，房主可复制每个角色的专属邀请链接。
- 邀请令牌放在 URL fragment 中，首次打开后写入玩家浏览器并从地址栏清除；服务端只保存令牌哈希。
- 阶段、搜证、公开线索、讨论结论和投票持久化到 `data/rooms/`，刷新后自动恢复。
- 玩家之间以 2 秒轮询同步。当前文件存储适合单进程自用部署；多实例部署需要换成 PostgreSQL/Redis。

## MVP 边界

- 已实现：文件夹/多文件导入、分批结构化解析、实时进度、可编辑审核台、动态人数/角色、服务端房间、专属邀请链接、断线恢复、阶段推进、搜证、投票、私人 AI DM、信息隔离测试。
- 导入接口不接受 ZIP；请选择解压后的最外层剧本目录。

## 验证

```powershell
npm test
npm run typecheck
npm run build
```
