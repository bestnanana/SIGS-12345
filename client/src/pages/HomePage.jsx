import React from "react";
import { ArrowRight, CheckCircle2, Clock3, FilePlus2, Inbox, MessageSquareText } from "lucide-react";
import { Link } from "react-router-dom";

const cards = [
  { label: "今日待办", value: "08", icon: Clock3, color: "text-amber-700 bg-amber-50" },
  { label: "本月受理", value: "126", icon: Inbox, color: "text-blue-700 bg-blue-50" },
  { label: "已回复事项", value: "93", icon: MessageSquareText, color: "text-emerald-700 bg-emerald-50" },
  { label: "满意评价", value: "97%", icon: CheckCircle2, color: "text-tsinghua-700 bg-tsinghua-50" }
];

export default function HomePage({ user }) {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-md bg-white shadow-soft ring-1 ring-slate-200">
        <div className="border-b border-slate-200 bg-gradient-to-r from-tsinghua-800 via-tsinghua-700 to-teal-700 px-6 py-7 text-white">
          <div className="text-sm text-tsinghua-100">SIGS接诉即办</div>
          <div className="mt-2 text-2xl font-semibold">欢迎，{user.name}</div>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-tsinghua-50">
            这里集中受理师生在学习、工作、科研和校园生活中的意见建议。系统会辅助识别事项领域，并支持全过程查询。
          </p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-md border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-500">{item.label}</div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-md ${item.color}`}>
                    <Icon size={20} />
                  </div>
                </div>
                <div className="mt-4 text-3xl font-semibold text-slate-900">{item.value}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="rounded-md bg-white p-6 shadow-soft ring-1 ring-slate-200">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">快捷入口</h2>
            <Link to="/tickets" className="text-sm font-medium text-tsinghua-700 hover:text-tsinghua-900">查看我的事项</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Link to="/new" className="group rounded-md border border-tsinghua-200 bg-tsinghua-50 p-5 transition hover:border-tsinghua-400">
              <FilePlus2 className="text-tsinghua-700" size={28} />
              <div className="mt-4 font-semibold text-slate-900">提出意见</div>
              <div className="mt-2 flex items-center gap-1 text-sm text-tsinghua-700">
                进入表单 <ArrowRight size={16} />
              </div>
            </Link>
            <Link to="/tickets" className="rounded-md border border-slate-200 bg-white p-5 transition hover:border-tsinghua-300">
              <Inbox className="text-blue-700" size={28} />
              <div className="mt-4 font-semibold text-slate-900">我的事项</div>
              <div className="mt-2 text-sm text-slate-500">查询办理状态</div>
            </Link>
            {user.role === "admin" && (
              <Link to="/admin" className="rounded-md border border-slate-200 bg-white p-5 transition hover:border-tsinghua-300">
                <MessageSquareText className="text-emerald-700" size={28} />
                <div className="mt-4 font-semibold text-slate-900">后台管理</div>
                <div className="mt-2 text-sm text-slate-500">查看并回复事项</div>
              </Link>
            )}
          </div>
        </div>

        <div className="rounded-md bg-white p-6 shadow-soft ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">办理流程</h2>
          <div className="mt-5 space-y-4">
            {["提交诉求", "智能分类", "单位办理", "回复评价"].map((step, index) => (
              <div key={step} className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tsinghua-700 text-sm font-semibold text-white">
                  {index + 1}
                </div>
                <div>
                  <div className="font-medium text-slate-900">{step}</div>
                  <div className="mt-1 text-sm text-slate-500">事项进入平台留痕，支持在线查询和反馈。</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
