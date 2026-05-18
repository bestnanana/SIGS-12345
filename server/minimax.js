const axios = require("axios");

const fields = ["教务", "人事", "学工", "科研", "后勤", "信息化", "其他", "国际学生学者"];

function localSuggestion(ticket) {
  const text = `${ticket.title} ${ticket.content}`;
  const rules = [
    ["信息化", /网络|系统|账号|邮箱|vpn|一卡通|门户|登录|信息/i],
    ["后勤", /宿舍|食堂|物业|维修|水电|空调|供暖|校园环境/i],
    ["教务", /课程|选课|成绩|考试|培养|毕业|学分/i],
    ["学工", /奖学金|助学|社团|辅导员|心理|学生工作/i],
    ["科研", /科研|项目|经费|实验室|论文|课题/i],
    ["人事", /招聘|职称|薪酬|社保|入职|教师/i],
    ["国际学生学者", /留学生|国际|签证|外籍|英文|交换/i]
  ];
  const matched = rules.find(([, pattern]) => pattern.test(text));
  const category = matched ? matched[0] : ticket.field || "其他";

  return {
    category,
    suggestion:
      `建议转交${ticket.department || category + "相关单位"}核实处理。可先向提交人确认具体时间、地点、涉及账号或证明材料，并在3个工作日内反馈初步处理意见。`
  };
}

async function askMinimax(ticket) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const groupId = process.env.MINIMAX_GROUP_ID;
  const model = process.env.MINIMAX_MODEL || "abab6.5s-chat";

  if (!apiKey || !groupId) {
    return localSuggestion(ticket);
  }

  const url = `https://api.minimax.chat/v1/text/chatcompletion_v2?GroupId=${groupId}`;
  const prompt = [
    "你是高校在线服务系统的接诉即办助手。",
    `可选事项领域：${fields.join("、")}。`,
    "请根据标题和内容给出JSON，字段为category和suggestion。suggestion面向管理员，要求具体、稳妥、简洁。",
    `标题：${ticket.title}`,
    `用户选择领域：${ticket.field}`,
    `主要单位：${ticket.department || "未选择"}`,
    `内容：${ticket.content}`
  ].join("\n");

  try {
    const response = await axios.post(
      url,
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 512
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        category: fields.includes(parsed.category) ? parsed.category : ticket.field,
        suggestion: parsed.suggestion || localSuggestion(ticket).suggestion
      };
    }
    return { category: ticket.field, suggestion: raw || localSuggestion(ticket).suggestion };
  } catch (error) {
    return localSuggestion(ticket);
  }
}

module.exports = { askMinimax };
