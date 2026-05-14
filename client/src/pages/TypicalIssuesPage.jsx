import React, { useEffect, useState } from "react";
import { Megaphone, MessageSquareText } from "lucide-react";
import { api } from "../api";
import { formatTime } from "../constants";

export default function TypicalIssuesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/public/typical-tickets")
      .then((res) => {
        if (Array.isArray(res.data)) {
          setItems(res.data);
          setError("");
        } else {
          setItems([]);
          setError("典型问题接口返回异常，请确认后端已重启到最新版本。");
        }
      })
      .catch(() => {
        setItems([]);
        setError("暂时无法获取典型问题，请确认后端服务正在运行。");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <section className="app-card mesh-hero">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-ai-primary shadow-sm">
            <Megaphone size={22} />
          </div>
          <div>
            <h1 className="text-[32px] font-semibold tracking-tight text-ai-title">典型问题发布</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ai-body">
              展示已由管理员审核发布的典型事项与办理答复，方便师生参考同类问题的处理路径。
            </p>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="app-card text-center text-ai-body">加载中...</div>
      ) : error ? (
        <div className="app-card text-center text-amber-700">{error}</div>
      ) : items.length === 0 ? (
        <div className="app-card text-center text-ai-body">暂无已发布典型问题</div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.id} className="app-card app-card-hover p-0">
              <div className="border-b border-ai-border px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-ai-title">{item.title}</h2>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ai-body">
                      <span>事项领域：{item.field}</span>
                      <span>部门：{item.department}</span>
                      <span>发布时间：{formatTime(item.published_at)}</span>
                    </div>
                  </div>
                  <span className="ai-chip">典型问题</span>
                </div>
              </div>
              <div className="grid gap-5 p-6 lg:grid-cols-2">
                <section>
                  <div className="mb-2 text-sm font-semibold text-ai-title">问题内容</div>
                  <div className="min-h-32 whitespace-pre-wrap rounded-2xl bg-ai-bg p-4 text-sm leading-7 text-ai-body ring-1 ring-ai-border">
                    {item.content}
                  </div>
                </section>
                <section>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ai-title">
                    <MessageSquareText size={16} />
                    办理答复
                  </div>
                  <div className="min-h-32 whitespace-pre-wrap rounded-2xl bg-ai-primary/5 p-4 text-sm leading-7 text-ai-body ring-1 ring-ai-primary/10">
                    {item.reply_content || "该事项已发布，暂无公开答复。"}
                    {item.reply_department ? (
                      <div className="mt-3 text-xs text-slate-500">
                        {item.reply_department} · {formatTime(item.reply_time)}
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
