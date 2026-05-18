export const fields = ["教务", "人事", "学工", "科研", "后勤", "信息化", "其他", "国际学生学者"];

export const departments = ["信数中心", "党政办", "学工办", "培养处", "财务办", "人事办"];

export const statusMap = {
  pending: {
    label: "待处理",
    className: "bg-amber-50 text-amber-800 ring-amber-200/80",
    badgeClassName: "bg-amber-50 text-amber-800 ring-amber-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]",
    dotClassName: "bg-amber-500"
  },
  processing: {
    label: "处理中",
    className: "bg-sky-50 text-sky-800 ring-sky-200/80",
    badgeClassName: "bg-sky-50 text-sky-800 ring-sky-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]",
    dotClassName: "bg-sky-500"
  },
  replied: {
    label: "已回复",
    className: "bg-teal-50 text-teal-800 ring-teal-200/80",
    badgeClassName: "bg-teal-50 text-teal-800 ring-teal-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]",
    dotClassName: "bg-teal-500"
  },
  completed: {
    label: "已完成",
    className: "bg-slate-100 text-slate-800 ring-slate-200",
    badgeClassName: "bg-slate-100 text-slate-700 ring-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]",
    dotClassName: "bg-slate-500"
  }
};

export function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
