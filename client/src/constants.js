export const fields = ["教务", "人事", "学工", "科研", "后勤", "信息化", "其他", "国际学生学者"];

export const departments = ["信数中心", "党政办", "学工办", "培养处", "财务办", "人事办"];

export const statusMap = {
  pending: { label: "待处理", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  processing: { label: "处理中", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  replied: { label: "已回复", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  completed: { label: "已完成", className: "bg-slate-100 text-slate-700 ring-slate-200" }
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
