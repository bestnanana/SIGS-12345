export const fields = ["教务", "人事", "学工", "科研", "后勤", "信息化", "其他", "For international students & scholars"];

export const fieldEnglishNames = {
  "教务": "Academic Affairs",
  "人事": "Human Resources",
  "学工": "Student Affairs",
  "科研": "Research",
  "后勤": "Logistics",
  "信息化": "Information Technology",
  "其他": "Other",
  "For international students & scholars": "For international students & scholars"
};

export function displayFieldName(field, language = "zh") {
  if (language === "en") return fieldEnglishNames[field] || field;
  return field;
}

export const departments = ["信息中心", "党政办", "学工办", "培养处", "财务办", "人事办"];

export const statusMap = {
  pending: {
    label: "待相关部门处理",
    className: "bg-amber-50 text-amber-800 ring-amber-200/80",
    badgeClassName: "bg-amber-50 text-amber-800 ring-amber-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]",
    dotClassName: "bg-amber-500"
  },
  completed: {
    label: "处理完成",
    className: "bg-slate-100 text-slate-800 ring-slate-200",
    badgeClassName: "bg-slate-100 text-slate-700 ring-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]",
    dotClassName: "bg-slate-500"
  }
};

export function formatTime(value, locale = "zh-CN") {
  if (!value) return "-";
  return new Date(value).toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export const defaultFields = fields;
export const defaultDepartments = departments;
