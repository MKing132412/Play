import type { ScriptPackage } from "./domain";

export const sampleScript: ScriptPackage = {
  id: "cruise-shadow",
  title: "游轮迷影",
  synopsis: "1938 年，一艘驶离上海的游轮上，失踪多年的往事与一宗命案同时浮出水面。",
  playerCount: 6,
  estimatedMinutes: 180,
  roles: [
    ["an-xiang", "安乡", "沉默寡言的青年，似乎熟悉这艘船。"],
    ["bai-shuyun", "白书云", "留学归来的青年，与死者有旧。"],
    ["lv-qingtian", "吕青甜", "举止得体，却对航程格外警觉。"],
    ["qiu-hong", "秋宏", "与游轮生意有密切往来的商人。"],
    ["ye-tongfang", "叶同方", "谨慎的医生，知道一些陈年秘密。"],
    ["zhou-yanyan", "周燕燕", "寻找失踪亲人的年轻女子。"],
  ].map(([id, name, publicBio]) => ({ id, name, publicBio, privateBrief: `${name}的私人经历与时间线仅本人可见。`, objectives: ["隐瞒不利往事", "查清白兴文之死"] })),
  phases: [
    { id: "night", name: "晚宴阶段", objective: "阅读角色本，建立人物关系", hostPrompt: "海风掠过甲板，晚宴即将开始。请阅读自己的角色密档。", allowedActions: ["read", "discuss"], durationMinutes: 20 },
    { id: "victim", name: "确认死者", objective: "搜集轮船与尸体线索，确认死者身份", hostPrompt: "一声尖叫划破夜色。请从轮船与尸体牌组搜证。", allowedActions: ["search", "discuss"], durationMinutes: 30 },
    { id: "culprit", name: "追查凶手", objective: "交换证词，锁定手法与嫌疑人", hostPrompt: "证词彼此矛盾。你们需要公开关键发现并说明怀疑。", allowedActions: ["search", "discuss"], durationMinutes: 35 },
    { id: "finale", name: "最终指认", objective: "提交凶手、动机与手法", hostPrompt: "汽笛最后一次响起。请独立完成最终指认。", allowedActions: ["vote"], durationMinutes: 10 },
  ],
  clueDecks: [
    { id: "ship", name: "轮船线索", drawLimitPerPlayer: 1 },
    { id: "body", name: "尸体线索", drawLimitPerPlayer: 1 },
    { id: "role", name: "角色线索", drawLimitPerPlayer: 2 },
  ],
  clues: [
    { id: "ship-map", title: "舱室分布图", content: "客舱、甲板与仓库之间存在一条容易被忽略的路线。", deckId: "ship", availableFromPhase: "victim", visibility: "private", sourceRef: "内置演示数据" },
    { id: "ship-log", title: "值班记录", content: "案发前后，甲板值班记录有十五分钟空白。", deckId: "ship", availableFromPhase: "victim", visibility: "private", sourceRef: "内置演示数据" },
    { id: "body-wound", title: "背部伤口", content: "尸体背部有很深的刀伤，但没有搏斗痕迹。", deckId: "body", availableFromPhase: "victim", visibility: "private", sourceRef: "内置演示数据" },
    { id: "body-poison", title: "毒物反应", content: "死者体内毒剂量不足以立即致死。", deckId: "body", availableFromPhase: "victim", visibility: "private", sourceRef: "内置演示数据" },
    { id: "role-letter", title: "未寄出的信", content: "信中反复提到十年前的一次隐瞒。", deckId: "role", availableFromPhase: "culprit", visibility: "private", sourceRef: "内置演示数据" },
    { id: "role-ticket", title: "旧船票", content: "船票日期与某人的不在场证明冲突。", deckId: "role", availableFromPhase: "culprit", visibility: "private", sourceRef: "内置演示数据" },
    { id: "role-photo", title: "被裁切的合照", content: "照片边缘仍能看出第七个人的衣袖。", deckId: "role", availableFromPhase: "culprit", visibility: "private", sourceRef: "内置演示数据" },
  ],
  truth: {
    culpritRoleId: "an-xiang",
    method: "利用甲板路线制造时间差",
    motive: "阻止十年前的真相被公开",
    timeline: ["晚宴前布置现场", "利用值班空档行动", "回到客舱制造不在场证明"],
  },
  endings: [
    { id: "solved", condition: "solved", title: "迷雾散去", text: "证词最终闭合，游轮靠岸前真相被揭开。" },
    { id: "escaped", condition: "escaped", title: "雾中航迹", text: "错误的指认让真凶得以随着人潮离船。" },
  ],
  review: [
    { path: "playerCount", confidence: "high", note: "规则本与六份角色本一致" },
    { path: "phases", confidence: "high", note: "规则本明确划分四个阶段" },
    { path: "clueDecks.role.drawLimitPerPlayer", confidence: "medium", note: "不同阶段抽取数量需在发布前复核" },
    { path: "truth.method", confidence: "low", note: "示例种子未录入完整答案本，需要管理员确认" },
  ],
};
