"use client";
import React, { createContext, useContext, useState, useCallback, useMemo } from "react";

export type Language = "zh" | "en";

export interface I18nContextType {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: string, fallback?: string) => string;
}

export const DICTIONARY: Record<Language, Record<string, string>> = {
  zh: {
    // 基础与通用
    "common.loading": "加载中…",
    "common.empty": "暂无数据",
    "common.cancel": "取消",
    "common.create": "创建",
    "common.save": "保存",
    "common.delete": "删除",
    "common.run": "运行",
    "common.edit": "编辑",
    "common.actions": "操作",
    "common.search": "搜索…",
    "common.status": "状态",
    "common.name": "名称",
    "common.updated": "更新时间",
    "common.created": "创建时间",
    "common.duration": "耗时",
    "common.type": "类型",
    "common.details": "详情",
    "common.switchLang": "English",

    // 侧边栏导航
    "nav.brand": "BrowserFlow",
    "nav.subtitle": "单用户 · 自托管",
    "nav.dashboard": "仪表盘",
    "nav.flows": "工作流",
    "nav.executions": "执行记录",
    "nav.schedules": "定时计划",
    "nav.credentials": "凭证管理",
    "nav.identities": "浏览器身份",
    "nav.templates": "模版中心",
    "nav.settings": "系统设置",
    "nav.system": "系统状态",
    "nav.signOut": "退出登录",
    "nav.localOnly": "本地只读模式",

    // 登录 / 初始化页
    "login.title": "BrowserFlow",
    "login.setupSubtitle": "创建管理员账户",
    "login.signInSubtitle": "登录以继续",
    "login.email": "邮箱",
    "login.password": "密码",
    "login.passwordHelp": "至少 12 位字符，需包含大小写字母、数字与符号中的至少三种",
    "login.initBtn": "初始化管理员",
    "login.signInBtn": "登录",
    "login.pleaseWait": "请稍候…",

    // 仪表盘
    "dash.title": "仪表盘",
    "dash.subtitle": "浏览器自动化平台运行概览",
    "dash.flows": "工作流",
    "dash.queued": "排队中",
    "dash.running": "运行中",
    "dash.workersOnline": "在线 Worker",
    "dash.noWorkerAlert": "当前无健康的 Chromium Worker 在线，工作流将在 Worker 连接前保持排队状态。",
    "dash.recentExecs": "最近执行",
    "dash.allExecs": "查看全部执行记录 →",
    "dash.colFlow": "工作流",
    "dash.colStatus": "状态",
    "dash.colTrigger": "触发源",
    "dash.colStarted": "开始时间",
    "dash.colDuration": "耗时",

    // 工作流
    "flows.title": "工作流",
    "flows.subtitle": "草稿、已发布版本与执行编排",
    "flows.importJson": "导入 JSON",
    "flows.newFlow": "新建工作流",
    "flows.searchPlaceholder": "搜索工作流…",
    "flows.sortUpdated": "最近更新",
    "flows.sortCreated": "最近创建",
    "flows.sortName": "按名称",
    "flows.archived": "已归档",
    "flows.empty": "暂无工作流 — 可直接新建或从模版创建。",
    "flows.colName": "名称",
    "flows.colPublished": "发布状态",
    "flows.colUpdated": "更新时间",
    "flows.published": "已发布",
    "flows.draftOnly": "仅草稿",
    "flows.duplicate": "复制",
    "flows.export": "导出",
    "flows.archive": "归档",
    "flows.unarchive": "取消归档",
    "flows.deleteConfirm": "确定要删除此工作流及其全部执行记录吗？",
    "flows.modalTitle": "新建工作流",
    "flows.modalName": "名称",

    // 执行记录
    "exec.title": "执行记录",
    "exec.subtitle": "跨重启持久化的执行运行历史",
    "exec.allStatuses": "全部状态",
    "exec.colExecution": "执行 ID",
    "exec.colFlow": "工作流",
    "exec.colStatus": "状态",
    "exec.colTrigger": "触发源",
    "exec.colAttempts": "尝试次数",
    "exec.colCreated": "创建时间",
    "exec.colDuration": "耗时",
    "exec.colError": "错误码",

    // 定时计划
    "sched.title": "定时计划",
    "sched.subtitle": "持久化 Cron 与单次调度计划（自动排重去重）",
    "sched.new": "新建计划",
    "sched.colName": "名称",
    "sched.colWhen": "执行周期",
    "sched.colPolicies": "策略",
    "sched.colState": "状态",
    "sched.colLastNext": "上次 / 下次",
    "sched.colLastRun": "最近执行",
    "sched.runNow": "立即执行",
    "sched.enable": "启用",
    "sched.disable": "停用",
    "sched.deleteConfirm": "确定删除该计划吗？",
    "sched.modalTitle": "新建计划",
    "sched.fieldFlow": "工作流（仅已发布）",
    "sched.fieldFlowSelect": "请选择…",
    "sched.fieldName": "计划名称",
    "sched.fieldType": "调度类型",
    "sched.typeCron": "Cron 表达式（周期执行）",
    "sched.typeOnce": "单次执行",
    "sched.fieldCron": "Cron 表达式",
    "sched.fieldRunAt": "执行时间",
    "sched.fieldTz": "时区",
    "sched.fieldMisfire": "过期处理策略",
    "sched.fieldOverlap": "重叠执行策略",

    // 凭证管理
    "cred.title": "凭证管理",
    "cred.subtitle": "采用 AES-256-GCM 主密钥强加密存储，敏感明文仅入库不回显，流内通过 credential:<name>#<field> 引用",
    "cred.new": "新建凭证",
    "cred.colName": "名称",
    "cred.colKind": "类型",
    "cred.colFields": "字段 / 引用标识",
    "cred.colUpdated": "更新时间",
    "cred.deleteConfirm": "确定删除该凭证？引用此凭证的工作流执行时将报错。",
    "cred.modalTitle": "新建凭证",
    "cred.namePlaceholder": "site-login",
    "cred.field": "字段",
    "cred.secretValue": "机密值",
    "cred.addField": "添加字段",
    "cred.saveEncrypted": "加密保存",

    // 浏览器身份
    "ident.title": "浏览器身份",
    "ident.subtitle": "持久化 Chromium 浏览器用户配置文件（Cookie、LocalStorage），单实例独占隔离执行",
    "ident.new": "新建身份",
    "ident.colName": "名称",
    "ident.colLock": "锁定状态",
    "ident.colLastUsed": "最近使用",
    "ident.inUse": "使用中",
    "ident.free": "空闲",
    "ident.resetProfile": "重置 Profile",
    "ident.resetConfirm": "确定清空此浏览器 Profile（Cookies 与本地缓存）？",
    "ident.deleteConfirm": "确定删除此身份及其专属 Profile？",
    "ident.modalTitle": "新建身份",
    "ident.desc": "描述",

    // 模版中心
    "tpl.title": "模版中心",
    "tpl.subtitle": "开箱即用的自动化流程模板，一键克隆为可编辑草稿",
    "tpl.use": "使用模版",
    "tpl.nodes": "个节点",
    "tpl.modalTitle": "基于模版创建草稿",
    "tpl.flowName": "工作流名称",
    "tpl.createDraft": "创建草稿",

    // 系统设置
    "settings.title": "系统设置",
    "settings.subtitle": "运行限制由启动环境变量控制并启动时校验",
    "settings.changePw": "修改密码",
    "settings.curPw": "当前密码",
    "settings.newPw": "新密码",
    "settings.pwHelp": "12 位以上字符，3 类字符组合；修改后其它会话将自动失效",
    "settings.pwSuccess": "密码已成功修改。",
    "settings.updatePwBtn": "更新密码",
    "settings.aiTitle": "AI 助手",
    "settings.aiDesc": "模型供应商：",
    "settings.secTitle": "安全与网络隔离",
    "settings.authMode": "认证模式：",
    "settings.privateAllowList": "私有网络白名单：",
    "settings.resourceLimits": "资源配额与限制（只读）",

    // 系统状态
    "system.title": "系统状态",
    "system.subtitle": "底层运行服务、Worker 集群与资源统计",
    "system.readiness": "就绪状态",
    "system.workers": "Workers 实例",
    "system.artifacts": "工件存储",
    "system.disk": "磁盘空间",
    "system.browserWorkers": "浏览器 Workers",
    "system.execByStatus": "执行状态统计",
  },
  en: {
    "common.loading": "Loading…",
    "common.empty": "Nothing here yet.",
    "common.cancel": "Cancel",
    "common.create": "Create",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.run": "Run",
    "common.edit": "Edit",
    "common.actions": "Actions",
    "common.search": "Search…",
    "common.status": "Status",
    "common.name": "Name",
    "common.updated": "Updated",
    "common.created": "Created",
    "common.duration": "Duration",
    "common.type": "Type",
    "common.details": "Details",
    "common.switchLang": "中文",

    "nav.brand": "BrowserFlow",
    "nav.subtitle": "single-user · self-hosted",
    "nav.dashboard": "Dashboard",
    "nav.flows": "Flows",
    "nav.executions": "Executions",
    "nav.schedules": "Schedules",
    "nav.credentials": "Credentials",
    "nav.identities": "Identities",
    "nav.templates": "Templates",
    "nav.settings": "Settings",
    "nav.system": "System",
    "nav.signOut": "Sign out",
    "nav.localOnly": "local-only mode",

    "login.title": "BrowserFlow",
    "login.setupSubtitle": "Create the administrator account",
    "login.signInSubtitle": "Sign in to continue",
    "login.email": "Email",
    "login.password": "Password",
    "login.passwordHelp": "At least 12 characters with 3 of: lowercase, uppercase, digits, symbols",
    "login.initBtn": "Initialize administrator",
    "login.signInBtn": "Sign in",
    "login.pleaseWait": "Please wait…",

    "dash.title": "Dashboard",
    "dash.subtitle": "Overview of your automation platform",
    "dash.flows": "Flows",
    "dash.queued": "Queued",
    "dash.running": "Running",
    "dash.workersOnline": "Workers online",
    "dash.noWorkerAlert": "No browser worker with a healthy Chromium is online. Browser flows will stay QUEUED until a worker connects.",
    "dash.recentExecs": "Recent executions",
    "dash.allExecs": "All executions →",
    "dash.colFlow": "Flow",
    "dash.colStatus": "Status",
    "dash.colTrigger": "Trigger",
    "dash.colStarted": "Started",
    "dash.colDuration": "Duration",

    "flows.title": "Flows",
    "flows.subtitle": "Drafts, published versions and executions",
    "flows.importJson": "Import JSON",
    "flows.newFlow": "New flow",
    "flows.searchPlaceholder": "Search flows…",
    "flows.sortUpdated": "Recently updated",
    "flows.sortCreated": "Recently created",
    "flows.sortName": "Name",
    "flows.archived": "Archived",
    "flows.empty": "No flows yet — create one or start from a template.",
    "flows.colName": "Name",
    "flows.colPublished": "Published",
    "flows.colUpdated": "Updated",
    "flows.published": "published",
    "flows.draftOnly": "draft only",
    "flows.duplicate": "Duplicate",
    "flows.export": "Export",
    "flows.archive": "Archive",
    "flows.unarchive": "Unarchive",
    "flows.deleteConfirm": "Delete this flow and all its executions?",
    "flows.modalTitle": "New flow",
    "flows.modalName": "Name",

    "exec.title": "Executions",
    "exec.subtitle": "History persists across restarts",
    "exec.allStatuses": "All statuses",
    "exec.colExecution": "Execution",
    "exec.colFlow": "Flow",
    "exec.colStatus": "Status",
    "exec.colTrigger": "Trigger",
    "exec.colAttempts": "Attempts",
    "exec.colCreated": "Created",
    "exec.colDuration": "Duration",
    "exec.colError": "Error",

    "sched.title": "Schedules",
    "sched.subtitle": "Persistent cron and one-shot schedules (survive restarts, de-duplicated by planned fire time)",
    "sched.new": "New schedule",
    "sched.colName": "Name",
    "sched.colWhen": "When",
    "sched.colPolicies": "Policies",
    "sched.colState": "State",
    "sched.colLastNext": "Last / Next",
    "sched.colLastRun": "Last run",
    "sched.runNow": "Run now",
    "sched.enable": "Enable",
    "sched.disable": "Disable",
    "sched.deleteConfirm": "Delete schedule?",
    "sched.modalTitle": "New schedule",
    "sched.fieldFlow": "Flow (published only)",
    "sched.fieldFlowSelect": "Select…",
    "sched.fieldName": "Name",
    "sched.fieldType": "Type",
    "sched.typeCron": "Cron (recurring)",
    "sched.typeOnce": "One-shot",
    "sched.fieldCron": "Cron expression",
    "sched.fieldRunAt": "Run at",
    "sched.fieldTz": "Timezone",
    "sched.fieldMisfire": "Misfire policy",
    "sched.fieldOverlap": "Overlap policy",

    "cred.title": "Credentials",
    "cred.subtitle": "Encrypted with AES-256-GCM under the master key. Values are never shown again; flows reference them as credential:<name>#<field>.",
    "cred.new": "New credential",
    "cred.colName": "Name",
    "cred.colKind": "Kind",
    "cred.colFields": "Fields / references",
    "cred.colUpdated": "Updated",
    "cred.deleteConfirm": "Delete credential? Flows referencing it will fail at runtime.",
    "cred.modalTitle": "New credential",
    "cred.namePlaceholder": "site-login",
    "cred.field": "field",
    "cred.secretValue": "secret value",
    "cred.addField": "Add field",
    "cred.saveEncrypted": "Save encrypted",

    "ident.title": "Identities",
    "ident.subtitle": "Persistent Chromium profiles (cookies, storage). Each identity has its own directory and is used by at most one execution at a time.",
    "ident.new": "New identity",
    "ident.colName": "Name",
    "ident.colLock": "Lock",
    "ident.colLastUsed": "Last used",
    "ident.inUse": "in use",
    "ident.free": "free",
    "ident.resetProfile": "Reset profile",
    "ident.resetConfirm": "Wipe the browser profile (cookies/storage)?",
    "ident.deleteConfirm": "Delete identity and its profile?",
    "ident.modalTitle": "New identity",
    "ident.desc": "Description",

    "tpl.title": "Templates",
    "tpl.subtitle": "Templates create an editable Draft; nothing runs automatically. They target the bundled local E2E site (variable baseUrl).",
    "tpl.use": "Use",
    "tpl.nodes": "nodes",
    "tpl.modalTitle": "Create draft from template",
    "tpl.flowName": "Flow name",
    "tpl.createDraft": "Create draft",

    "settings.title": "Settings",
    "settings.subtitle": "Runtime limits are configured through environment variables and validated at startup.",
    "settings.changePw": "Change password",
    "settings.curPw": "Current password",
    "settings.newPw": "New password",
    "settings.pwHelp": "12+ chars, 3 character classes; other sessions are revoked",
    "settings.pwSuccess": "Password changed.",
    "settings.updatePwBtn": "Update password",
    "settings.aiTitle": "AI assistant",
    "settings.aiDesc": "Provider:",
    "settings.secTitle": "Security & network",
    "settings.authMode": "Auth mode:",
    "settings.privateAllowList": "Private network allow-list:",
    "settings.resourceLimits": "Resource limits (read-only)",

    "system.title": "System status",
    "system.subtitle": "Runtime components, worker pool and resource metrics",
    "system.readiness": "Readiness",
    "system.workers": "Workers",
    "system.artifacts": "Artifacts",
    "system.disk": "Disk (data dir)",
    "system.browserWorkers": "Browser workers",
    "system.execByStatus": "Executions by status",
  },
};

const I18nContext = createContext<I18nContextType>({
  lang: "zh",
  setLang: () => {},
  t: (key: string, fallback?: string) => fallback ?? key,
});

function getInitialLang(): Language {
  if (typeof window === "undefined") return "zh";
  try {
    const saved = localStorage.getItem("bf_lang") as Language | null;
    if (saved === "zh" || saved === "en") return saved;
  } catch {}
  return "zh";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>(getInitialLang);

  const setLang = useCallback((l: Language) => {
    setLangState(l);
    try {
      localStorage.setItem("bf_lang", l);
    } catch {}
  }, []);

  const t = useCallback(
    (key: string, fallback?: string): string => {
      return DICTIONARY[lang]?.[key] ?? fallback ?? DICTIONARY.en[key] ?? key;
    },
    [lang]
  );

  const val = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={val}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextType {
  return useContext(I18nContext);
}
