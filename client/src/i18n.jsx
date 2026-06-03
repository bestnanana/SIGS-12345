import React, { createContext, useContext, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { statusMap as baseStatusMap } from "./constants";

const dictionaries = {
  zh: {
    "nav.home": "首页",
    "nav.new": "提出意见",
    "nav.myTickets": "我发起的",
    "nav.admin": "后台工作台",
    "nav.typical": "典型问题",

    "role.user": "用户",
    "role.admin": "管理员",
    "role.super_admin": "超级管理员",
    "role.liaison": "联络员",
    "role.dept_admin": "部门管理员",
    "role.normalUser": "普通用户",

    "action.searchTickets": "搜索事项",
    "action.notifications": "通知",
    "action.logout": "退出登录",
    "action.switchRole": "切换身份",
    "action.adminIdentity": "管理员身份",
    "action.userIdentity": "普通用户身份",
    "action.refresh": "刷新",
    "action.back": "返回",
    "action.save": "保存",
    "action.submit": "提交",
    "action.submitting": "提交中...",
    "action.viewDetails": "查看详情",
    "action.viewAll": "查看全部",
    "action.publish": "发布典型问题",
    "action.unpublish": "取消发布",
    "action.reply": "提交回复",
    "action.transfer": "转办事项",

    "common.loading": "加载中...",
    "common.none": "暂无",
    "common.department": "部门",
    "common.currentDepartment": "当前承办",
    "common.submitter": "提交人",
    "common.submittedAt": "提交时间",
    "common.updatedAt": "最近更新",
    "common.field": "事项领域",
    "common.publishedAt": "发布时间",
    "common.items": "{count} 项",
    "common.records": "{count} 条事项",
    "common.notSet": "未设置",
    "common.notAssigned": "暂未分配",
    "common.anonymous": "匿名",
    "common.noData": "暂无数据",

    "status.pending": "待相关部门处理",
    "status.completed": "处理完成",
    "userStatus.pending": "待相关部门处理",
    "userStatus.handled": "处理完成",

    "login.title": "SIGS投诉即办",
    "login.subtitle": "诉求提交、部门流转、办理进度和结果反馈集中在同一个工作台。",
    "login.badge": "SIGS Prompt Complaint",
    "login.heading": "登录入口",
    "login.welcome": "欢迎回来",
    "login.welcomeDesc": "使用校园账号进入诉求办理平台。",
    "login.ssoHeading": "统一身份认证登录",
    "login.ssoDesc": "通过清华大学统一身份认证平台登录系统",
    "login.ssoButton": "统一身份认证登录",
    "login.ssoRedirecting": "跳转中...",
    "login.unionId": "人员编号",
    "login.username": "用户名",
    "login.password": "密码",
    "login.loginButton": "登录系统",
    "login.verifying": "验证中",
    "login.entering": "进入中",
    "login.enterWorkspace": "正在进入工作台",
    "login.ssoFailed": "统一身份认证地址生成失败",
    "login.failed": "登录失败",
    "login.localLogin": "账号密码登录",
    "login.ssoLogin": "SSO 登录",
    "login.ssoHint": "校内师生请使用统一身份认证登录",
    "login.localHint": "外部人员请使用账号密码登录",

    "home.myTickets": "我发起的事项",
    "home.myTicketsDesc": "同步显示“我发起的事项”中的事项数量。",
    "home.enterMyTickets": "进入我发起的事项",
    "home.unresolved": "待相关部门处理事项",
    "home.unresolvedDesc": "点击事项可进入对应详情页。",
    "home.noUnresolved": "暂无待相关部门处理事项",
    "home.ticketsLoading": "事项加载中...",

    "typical.title": "典型问题",
    "typical.desc": "汇总已公开的高频事项与办理答复，方便参考同类问题的处理方式。",
    "typical.empty": "暂无已发布典型问题",
    "typical.answer": "办理答复",
    "typical.noAnswer": "该事项已发布，暂无公开答复。",
    "typical.tag": "典型问题",

    "tickets.title": "我发起的事项",
    "tickets.desc": "查看本人发起事项的办理进度与回复结果。",
    "tickets.all": "全部事项",
    "tickets.empty": "暂无事项",
    "tickets.emptyGroup": "该分类下暂无事项",

    "form.badge": "事项提交",
    "form.title": "提出意见",
    "form.desc": "请如实填写事项信息，AI 将辅助识别领域并交由相关部门办理。",
    "form.notice": "使用须知",
    "form.inputTitle": "标题",
    "form.content": "内容",
    "form.attachments": "附件上传",
    "form.chooseFiles": "选择附件",
    "form.name": "姓名",
    "form.phone": "手机号码",
    "form.anonymous": "匿名提交，管理端不显示我的姓名和联系方式",
    "form.unknownDept": "请选择部门",
    "form.titlePlaceholder": "请输入事项标题",
    "form.contentPlaceholder": "请坚持一事一条，详细描述相关情况",
    "form.phonePlaceholder": "请输入手机号码",

    "detail.missing": "事项不存在",
    "detail.loadFailed": "事项加载失败，请稍后重试",
    "detail.userContent": "用户提交内容",
    "detail.uploadedFiles": "用户上传附件",
    "detail.progress": "办理进度",
    "detail.currentStatus": "当前办理状态",
    "detail.currentHandler": "当前办理人",
    "detail.replyStatus": "管理员回复状况",
    "detail.transferRecords": "转办记录",
    "detail.progressTimeline": "进度情况",
    "detail.rateTitle": "评价办理结果",
    "detail.rateDesc": "你的反馈会帮助平台持续改进服务质量。",
    "detail.like": "点赞",
    "detail.dislike": "点踩",
    "detail.favorite": "收藏",
    "detail.noAttachments": "暂无附件",

    "admin.sideTitle": "管理端",
    "admin.workbench": "工作台",
    "admin.sideDesc": "聚焦学生事项办理与运行数据分析。",
    "admin.menuTickets": "事项处理",
    "admin.menuTicketsDesc": "办理学生提交事项",
    "admin.menuAnalytics": "数据统计分析",
    "admin.menuAnalyticsDesc": "查看事项结构与办理进展",
    "admin.pendingWork": "待推进事项",
    "admin.publishedTypical": "已发布典型问题",
    "admin.ticketProcessing": "学生事项处理",
    "admin.ticketQueue": "事项队列",
    "admin.viewAndReply": "查看事项并办理回复",
    "admin.noTodos": "暂无待办事项",
    "admin.selectTicket": "请选择事项",
    "admin.ticketContent": "事项内容",
    "admin.currentStatus": "当前状态",
    "admin.statusDistribution": "状态分布",
    "admin.byStatus": "按状态",
    "admin.byDepartment": "按部门",
    "admin.byField": "按领域",
    "admin.analyticsTitle": "事项运行概览",
    "admin.analyticsDesc": "统计当前管理员权限范围内的事项数量、状态分布、部门流向和事项领域。",
    "admin.role": "角色",
    "admin.visibleTickets": "可见事项",
    "admin.scope": "权限范围",
    "admin.departmentScope": "{department}权限范围",
    "admin.allScope": "全部范围",
    "admin.activeTickets": "待相关部门处理事项",
    "admin.activeTicketsNote": "未完成事项总量",
    "admin.replyRate": "处理完成事项",
    "admin.replyRateNote": "当前已处理完成数量",
    "admin.completeRate": "完成率",
    "admin.completeRateNote": "已完成事项占比",
    "admin.priority": "优先处理",
    "admin.published": "已发布",
    "admin.detailsPage": "详情页",
    "admin.refreshData": "刷新数据",
    "admin.refreshUsers": "刷新用户",
    "admin.statusHandling": "办理状态",
    "admin.pendingStatus": "待相关部门处理",
    "admin.completedStatus": "处理完成",
    "admin.menuConfig": "配置管理",
    "admin.menuConfigDesc": "表单领域和部门配置",
    "admin.configFields": "事项领域",
    "admin.configDepartments": "部门配置",
    "admin.menuPermissions": "授权管理",
    "admin.menuPermissionsDesc": "部门管理员权限配置",
    "admin.itemsCount": "{count} 项",
    "admin.departmentTicketQueue": "{department}事项队列",
    "admin.submittedAt": "提交时间",
    "admin.submitter": "提交人",
    "admin.contact": "联系方式",
    "admin.attachments": "附件",
    "admin.departmentReply": "处理部门答复",
    "admin.replyAdminSuffix": "管理员",
    "admin.processingInfo": "处理信息",
    "admin.onlyCurrentDeptCanHandle": "该事项当前承办部门为 {department}，只能由该部门管理员处理。",
    "admin.replyPlaceholder": "请填写处理结果说明...",
    "admin.uploadAttachment": "上传附件",
    "admin.filesCount": "{count} 个附件",
    "admin.submitReplyResult": "提交处理结果",
    "admin.submitting": "提交中...",
    "admin.transferTicket": "转办事项",
    "admin.chooseTransferDept": "选择转办目标部门...",
    "admin.transferNotePlaceholder": "转办说明（选填）...",
    "admin.confirmTransfer": "确认转办",
    "admin.transferring": "转办中...",
    "admin.workflow": "事项流转流程",
    "admin.transferRecords": "转办记录",
    "admin.satisfaction": "满意度调查",
    "admin.score": "评分",
    "admin.noSatisfactionComment": "用户未填写文字评价。",
    "admin.waitingSatisfaction": "等待发起人提交满意度评价。",
    "admin.satisfactionAfterCompleted": "事项完成后将开放评价。",
    "admin.satisfactionDistribution": "满意度分布",
    "admin.scoreLabel": "{score} 分",
    "admin.submitStep": "提交事项",
    "admin.departmentStep": "相关部门处理",
    "admin.finishStep": "处理完成",
    "admin.student": "学生",
    "admin.submittedToDepartment": "学生通过平台提交事项，等待相关部门处理。",
    "admin.selectedDepartment": "申请选择部门",
    "admin.handlerDepartment": "办理部门",
    "admin.departmentReplyLine": "部门回复",
    "admin.departmentCompleted": "相关部门已完成处理。",
    "admin.waitingDepartment": "事项已提交，等待相关部门处理。",
    "admin.completedAt": "完成时间",
    "admin.flowFinished": "事项办理完成，流程结束。",
    "admin.finishPending": "办理结果确认后进入最终状态。",
    "admin.expandMenu": "展开菜单",
    "admin.collapseMenu": "收起菜单",
    "admin.ticketApiInvalid": "后台事项接口返回异常，请确认后端已重启到最新版本。",
    "admin.ticketLoadFailed": "后台事项加载失败，请确认后端服务正在运行。",
    "admin.transferFailed": "转办失败",
    "admin.replySubmitted": "处理结果已提交",
    "admin.replyFailed": "回复提交失败"
  },
  en: {
    "nav.home": "Home",
    "nav.new": "Submit",
    "nav.myTickets": "My Requests",
    "nav.admin": "Admin Console",
    "nav.typical": "Typical Issues",

    "role.user": "User",
    "role.admin": "Admin",
    "role.super_admin": "Super Admin",
    "role.liaison": "Liaison",
    "role.dept_admin": "Dept Admin",
    "role.normalUser": "User",

    "action.searchTickets": "Search tickets",
    "action.notifications": "Notifications",
    "action.logout": "Log out",
    "action.switchRole": "Switch role",
    "action.adminIdentity": "Admin mode",
    "action.userIdentity": "User mode",
    "action.refresh": "Refresh",
    "action.back": "Back",
    "action.save": "Save",
    "action.submit": "Submit",
    "action.submitting": "Submitting...",
    "action.viewDetails": "View details",
    "action.viewAll": "View all",
    "action.publish": "Publish typical issue",
    "action.unpublish": "Unpublish",
    "action.reply": "Submit reply",
    "action.transfer": "Transfer ticket",

    "common.loading": "Loading...",
    "common.none": "None",
    "common.department": "Department",
    "common.currentDepartment": "Current owner",
    "common.submitter": "Submitter",
    "common.submittedAt": "Submitted",
    "common.updatedAt": "Updated",
    "common.field": "Category",
    "common.publishedAt": "Published",
    "common.items": "{count} items",
    "common.records": "{count} tickets",
    "common.notSet": "Not set",
    "common.notAssigned": "Unassigned",
    "common.anonymous": "Anonymous",
    "common.noData": "No data",

    "status.pending": "Pending Department Handling",
    "status.completed": "Completed",
    "userStatus.pending": "Pending Department Handling",
    "userStatus.handled": "Completed",

    "login.title": "SIGS Prompt Complaint",
    "login.subtitle": "Submit requests, track department processing, and receive results — all in one workspace.",
    "login.badge": "SIGS Prompt Complaint",
    "login.heading": "Login",
    "login.welcome": "Welcome Back",
    "login.welcomeDesc": "Use your campus account to enter the service platform.",
    "login.ssoHeading": "SSO Login",
    "login.ssoDesc": "Log in via Tsinghua University Single Sign-On",
    "login.ssoButton": "SSO Login",
    "login.ssoRedirecting": "Redirecting...",
    "login.unionId": "Union ID",
    "login.username": "Username",
    "login.password": "Password",
    "login.loginButton": "Log in",
    "login.verifying": "Verifying",
    "login.entering": "Entering",
    "login.enterWorkspace": "Entering workspace",
    "login.ssoFailed": "Failed to generate SSO URL",
    "login.failed": "Login failed",
    "login.localLogin": "Username/Password",
    "login.ssoLogin": "SSO Login",
    "login.ssoHint": "Tsinghua members: please use SSO",
    "login.localHint": "External users: please use username/password",

    "home.myTickets": "My Requests",
    "home.myTicketsDesc": "Shows the total number of requests you initiated.",
    "home.enterMyTickets": "Open My Requests",
    "home.unresolved": "Requests Pending Department Handling",
    "home.unresolvedDesc": "Open a request to view its details.",
    "home.noUnresolved": "No pending requests",
    "home.ticketsLoading": "Loading tickets...",

    "typical.title": "Typical Issues",
    "typical.desc": "Public high-frequency issues and official replies for reference.",
    "typical.empty": "No published typical issues",
    "typical.answer": "Official Reply",
    "typical.noAnswer": "This issue is published, but no public reply is available.",
    "typical.tag": "Typical Issue",

    "tickets.title": "My Requests",
    "tickets.desc": "Track the progress and replies for requests you initiated.",
    "tickets.all": "All Tickets",
    "tickets.empty": "No tickets",
    "tickets.emptyGroup": "No tickets in this status",

    "form.badge": "Ticket Submission",
    "form.title": "Submit Feedback",
    "form.desc": "Fill in the ticket details. AI will help identify the category and route it to the proper department.",
    "form.notice": "Instructions",
    "form.inputTitle": "Title",
    "form.content": "Content",
    "form.attachments": "Attachments",
    "form.chooseFiles": "Choose files",
    "form.name": "Name",
    "form.phone": "Phone",
    "form.anonymous": "Submit anonymously. Admins will not see my name or contact details.",
    "form.unknownDept": "Please select a department",
    "form.titlePlaceholder": "Enter ticket title",
    "form.contentPlaceholder": "Describe one issue clearly with relevant details",
    "form.phonePlaceholder": "Enter phone number",

    "detail.missing": "Ticket not found",
    "detail.loadFailed": "Failed to load ticket, please try again later",
    "detail.userContent": "Submitted Content",
    "detail.uploadedFiles": "Uploaded Files",
    "detail.progress": "Progress",
    "detail.currentStatus": "Current Status",
    "detail.currentHandler": "Current Handler",
    "detail.replyStatus": "Admin Reply Status",
    "detail.transferRecords": "Transfer Records",
    "detail.progressTimeline": "Timeline",
    "detail.rateTitle": "Rate the Result",
    "detail.rateDesc": "Your feedback helps improve service quality.",
    "detail.like": "Like",
    "detail.dislike": "Dislike",
    "detail.favorite": "Favorite",
    "detail.noAttachments": "No attachments",

    "admin.sideTitle": "Admin",
    "admin.workbench": "Workbench",
    "admin.sideDesc": "Manage student tickets and operational analytics.",
    "admin.menuTickets": "Ticket Handling",
    "admin.menuTicketsDesc": "Handle submitted tickets",
    "admin.menuAnalytics": "Analytics",
    "admin.menuAnalyticsDesc": "Review ticket structure and progress",
    "admin.pendingWork": "Active tickets",
    "admin.publishedTypical": "Published typical issues",
    "admin.ticketProcessing": "Student Ticket Handling",
    "admin.ticketQueue": "ticket queue",
    "admin.viewAndReply": "Review tickets and submit replies",
    "admin.noTodos": "No pending tickets",
    "admin.selectTicket": "Select a ticket",
    "admin.ticketContent": "Ticket Content",
    "admin.currentStatus": "Current Status",
    "admin.statusDistribution": "Status Distribution",
    "admin.byStatus": "By Status",
    "admin.byDepartment": "By Department",
    "admin.byField": "By Category",
    "admin.analyticsTitle": "Ticket Overview",
    "admin.analyticsDesc": "Statistics for ticket volume, status, departments, and categories within your permission scope.",
    "admin.role": "Role",
    "admin.visibleTickets": "Visible Tickets",
    "admin.scope": " scope",
    "admin.departmentScope": "{department} scope",
    "admin.allScope": "All scope",
    "admin.activeTickets": "Active Tickets",
    "admin.activeTicketsNote": "Total unfinished tickets",
    "admin.replyRate": "Completed Tickets",
    "admin.replyRateNote": "Current completed ticket count",
    "admin.completeRate": "Completion Rate",
    "admin.completeRateNote": "Completed ticket percentage",
    "admin.priority": "Priority",
    "admin.published": "Published",
    "admin.detailsPage": "Details",
    "admin.refreshData": "Refresh Data",
    "admin.refreshUsers": "Refresh Users",
    "admin.statusHandling": "Handling Status",
    "admin.pendingStatus": "Pending Department Handling",
    "admin.completedStatus": "Completed",
    "admin.menuConfig": "Configuration",
    "admin.menuConfigDesc": "Form categories and department settings",
    "admin.configFields": "Categories",
    "admin.configDepartments": "Departments",
    "admin.menuPermissions": "Permissions",
    "admin.menuPermissionsDesc": "Department admin permission settings",
    "admin.itemsCount": "{count} items",
    "admin.departmentTicketQueue": "{department} ticket queue",
    "admin.submittedAt": "Submitted",
    "admin.submitter": "Submitter",
    "admin.contact": "Contact",
    "admin.attachments": "Attachments",
    "admin.departmentReply": "Handling Department Reply",
    "admin.replyAdminSuffix": "Admin",
    "admin.processingInfo": "Processing Info",
    "admin.onlyCurrentDeptCanHandle": "The current handling department is {department}; only admins of this department can process it.",
    "admin.replyPlaceholder": "Enter the processing result...",
    "admin.uploadAttachment": "Upload attachment",
    "admin.filesCount": "{count} attachments",
    "admin.submitReplyResult": "Submit Result",
    "admin.submitting": "Submitting...",
    "admin.transferTicket": "Transfer Ticket",
    "admin.chooseTransferDept": "Select target department...",
    "admin.transferNotePlaceholder": "Transfer note (optional)...",
    "admin.confirmTransfer": "Confirm Transfer",
    "admin.transferring": "Transferring...",
    "admin.workflow": "Workflow",
    "admin.transferRecords": "Transfer Records",
    "admin.satisfaction": "Satisfaction Survey",
    "admin.score": "Score",
    "admin.noSatisfactionComment": "No written comment from the user.",
    "admin.waitingSatisfaction": "Waiting for the submitter to rate the result.",
    "admin.satisfactionAfterCompleted": "Rating will be available after the ticket is completed.",
    "admin.satisfactionDistribution": "Satisfaction Distribution",
    "admin.scoreLabel": "{score} pts",
    "admin.submitStep": "Submit Ticket",
    "admin.departmentStep": "Department Handling",
    "admin.finishStep": "Completed",
    "admin.student": "Student",
    "admin.submittedToDepartment": "The student submitted the ticket and is waiting for department handling.",
    "admin.selectedDepartment": "Selected department",
    "admin.handlerDepartment": "Handling department",
    "admin.departmentReplyLine": "Department reply",
    "admin.departmentCompleted": "The department has completed handling.",
    "admin.waitingDepartment": "The ticket has been submitted and is waiting for department handling.",
    "admin.completedAt": "Completed at",
    "admin.flowFinished": "The ticket is completed and the workflow has ended.",
    "admin.finishPending": "The ticket will enter final status after confirmation.",
    "admin.expandMenu": "Expand menu",
    "admin.collapseMenu": "Collapse menu",
    "admin.ticketApiInvalid": "The admin ticket API returned an unexpected response. Please confirm the backend is up to date.",
    "admin.ticketLoadFailed": "Failed to load admin tickets. Please confirm the backend service is running.",
    "admin.transferFailed": "Transfer failed",
    "admin.replySubmitted": "Processing result submitted",
    "admin.replyFailed": "Failed to submit reply"
  }
};

const LOCALE_TO_LANG = { cn: "zh", en: "en" };
const LANG_TO_LOCALE = { zh: "cn", en: "en" };
const VALID_LOCALES = ["cn", "en"];

function interpolate(template, params = {}) {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const { locale: rawLocale } = useParams();
  const locale = VALID_LOCALES.includes(rawLocale) ? rawLocale : "cn";
  const language = LOCALE_TO_LANG[locale] || "zh";

  const value = useMemo(() => {
    const t = (key, params) => interpolate(dictionaries[language]?.[key] || dictionaries.zh[key] || key, params);
    return { language, locale, t };
  }, [language, locale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

export function useLocale() {
  const { locale, language } = useLanguage();
  return { locale, language, otherLocale: locale === "cn" ? "en" : "cn" };
}

export function useLocaleNavigate() {
  const { locale } = useLocale();
  const navigate = useNavigate();
  return (path, options) => {
    if (typeof path === "number") return navigate(path);
    return navigate(`/${locale}${path}`, options);
  };
}

export function LocaleLink({ to, ...props }) {
  const { locale } = useLocale();
  return <Link to={`/${locale}${to}`} {...props} />;
}

export function localePath(path, locale) {
  return `/${locale}${path}`;
}

export function switchLocalePath(currentLocale, pathname) {
  const other = currentLocale === "cn" ? "en" : "cn";
  const stripped = pathname.replace(/^\/(?:cn|en)/, "") || "/";
  return `/${other}${stripped}`;
}

export { LOCALE_TO_LANG, LANG_TO_LOCALE, VALID_LOCALES };

export function useStatusMap() {
  const { t } = useLanguage();
  return useMemo(
    () => Object.fromEntries(
      Object.entries(baseStatusMap).map(([key, value]) => [
        key,
        { ...value, label: t(`status.${key}`) }
      ])
    ),
    [t]
  );
}

export function useUserStatusMap() {
  const { t } = useLanguage();
  return useMemo(() => {
    const pending = baseStatusMap.pending;
    const handled = baseStatusMap.completed;
    return {
      pending: { ...pending, label: t("userStatus.pending") },
      handled: { ...handled, label: t("userStatus.handled") }
    };
  }, [t]);
}

export function toUserStatusKey(status) {
  if (status === "completed") return "handled";
  return "pending";
}
