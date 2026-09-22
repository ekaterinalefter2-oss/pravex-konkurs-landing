/**
 * Серверная функция (Vercel). Принимает заявку конкурса с сайта и отправляет
 * её письмом напрямую через SMTP вашей почты VK WorkMail — без сторонних
 * сервисов вроде FormSubmit.
 *
 * Раньше письмо уходило через FormSubmit: сначала это делал браузер участника
 * (и мог не достучаться до иностранного сервиса из некоторых сетей в России),
 * потом это перенесли на сервер сайта — но выяснилось, что защита Cloudflare
 * перед FormSubmit блокирует именно запросы с серверов (принимает их за ботов).
 * SMTP-отправка с прямой авторизацией на smtp.mail.ru обоих этих проблем не имеет.
 *
 * Нужные переменные окружения — добавляются в Vercel (Settings → Environment
 * Variables), в код не попадают:
 *   SMTP_USER — адрес почты, с которой отправляем, например marketing@pravex24.ru
 *   SMTP_PASS — пароль приложения для этого ящика (Аккаунт → Безопасность →
 *               Пароли для внешних приложений в VK WorkMail; обычный пароль
 *               от почты для SMTP не подходит)
 *   SMTP_TO   — куда слать заявки, через запятую можно указать несколько
 *               адресов, например "marketing@pravex24.ru,prav-ex748@pravex24.ru"
 *               (по умолчанию — то же значение, что и SMTP_USER)
 * Необязательные, для другого провайдера почты:
 *   SMTP_HOST (по умолчанию smtp.mail.ru), SMTP_PORT (по умолчанию 465)
 */

const nodemailer = require("nodemailer");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "method_not_allowed" });
    return;
  }

  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    console.error("Не настроены переменные окружения почты: нужны SMTP_USER и SMTP_PASS");
    res.status(500).json({ success: false, error: "server_not_configured" });
    return;
  }
  const SMTP_HOST = process.env.SMTP_HOST || "smtp.mail.ru";
  const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
  const SMTP_TO = (process.env.SMTP_TO || SMTP_USER).split(",").map((s) => s.trim()).filter(Boolean);

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  // Поля вида {"Ключ": "значение"} — превращаем в простую HTML-таблицу и текстовую копию.
  const entries = Object.entries(body).filter(([key]) => !key.startsWith("_"));
  const escapeHtml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const htmlRows = entries
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6B6072;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`)
    .join("");
  const html = `<table cellpadding="0" cellspacing="0">${htmlRows}</table>`;
  const text = entries.map(([k, v]) => `${k}: ${v}`).join("\n");

  const subject = typeof body._subject === "string" && body._subject ? body._subject : "Заявка — конкурс видеоотзывов ПРАВЭКС";
  const replyTo = typeof body._replyto === "string" && body._replyto ? body._replyto : undefined;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  try {
    await transporter.sendMail({
      from: `"ПРАВЭКС · Конкурс" <${SMTP_USER}>`,
      to: SMTP_TO,
      replyTo,
      subject,
      text,
      html
    });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Ошибка отправки письма по SMTP:", err);
    res.status(502).json({ success: false, error: "smtp_failed", message: String((err && err.message) || err) });
  }
};
