/**
 * Серверная функция (Vercel). Принимает заявку конкурса с сайта и сама
 * пересылает её на почту через FormSubmit — вместо того, чтобы это делал
 * браузер участника напрямую.
 *
 * Почему так: раньше сайт обращался к formsubmit.co прямо из браузера
 * участника. Из некоторых сетей в России иностранные сервисы бывают
 * недоступны или нестабильны — заявка могла не дойти без единой ошибки
 * на экране у участника. Теперь к formsubmit.co обращается сервер сайта
 * (он работает за границей, где сервис доступен всегда), а участник
 * весь путь общается только с нашим собственным доменом.
 *
 * Адрес получателя не секрет, но чтобы поменять его без переразвёртывания
 * кода — можно переопределить переменной окружения FORMSUBMIT_URL в Vercel.
 */

const FORMSUBMIT_URL = process.env.FORMSUBMIT_URL || "https://formsubmit.co/ajax/marketing@pravex24.ru";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, error: "method_not_allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  try {
    const upstream = await fetch(FORMSUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await upstream.json().catch(() => null);
    // FormSubmit отвечает HTTP 200 даже когда письмо не ушло (форма ещё не
    // активирована, превышен лимит бесплатного тарифа и т.п.) — смотрим
    // на поле success в самом теле ответа, а не только на код ответа.
    const ok = upstream.ok && !!data && (data.success === true || data.success === "true");
    res.status(ok ? 200 : 502).json({ success: ok, upstream: data || null });
  } catch (err) {
    console.error("Ошибка пересылки заявки на почту:", err);
    res.status(502).json({ success: false, error: "upstream_failed" });
  }
};
