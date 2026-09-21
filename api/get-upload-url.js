/**
 * Серверная функция (Vercel). Выдаёт сайту одноразовую защищённую ссылку
 * для прямой загрузки видео в VK Object Storage (бакет приватный) —
 * и сразу же вторую ссылку, по которой организатор потом сможет посмотреть файл.
 *
 * Ключи доступа берутся из переменных окружения проекта на Vercel
 * (Settings → Environment Variables), сюда в код они не попадают:
 *   VK_S3_ENDPOINT, VK_S3_REGION, VK_S3_BUCKET,
 *   VK_S3_ACCESS_KEY_ID, VK_S3_SECRET_ACCESS_KEY
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const UPLOAD_URL_TTL_SEC = 15 * 60; // 15 минут — чтобы успеть загрузить файл
// У подписанных ссылок SigV4 жёсткий предел — меньше 7 дней. Берём 6 дней:
// с запасом покрывает обещанные участникам "3 рабочих дня" на просмотр ролика.
// Если понадобится позже — файл всегда можно найти в самом бакете, в консоли VK Cloud
// (объект лежит по пути, который приходит в письме в поле "objectKey" — см. ниже).
const VIEW_URL_TTL_SEC = 6 * 24 * 60 * 60;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const required = ["VK_S3_ENDPOINT", "VK_S3_REGION", "VK_S3_BUCKET", "VK_S3_ACCESS_KEY_ID", "VK_S3_SECRET_ACCESS_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error("Не настроены переменные окружения хранилища:", missing.join(", "));
    res.status(500).json({ error: "server_not_configured" });
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

  const filenameRaw = typeof body.filename === "string" ? body.filename : "video.mp4";
  const contentType = typeof body.contentType === "string" && body.contentType ? body.contentType : "video/mp4";

  const extMatch = filenameRaw.match(/\.([a-zA-Z0-9]+)$/);
  const ext = ((extMatch && extMatch[1]) || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";

  const today = new Date().toISOString().slice(0, 10);
  const rand = Math.random().toString(36).slice(2, 10);
  const objectKey = `konkurs/${today}/${Date.now()}-${rand}.${ext}`;

  const client = new S3Client({
    region: process.env.VK_S3_REGION,
    endpoint: process.env.VK_S3_ENDPOINT,
    forcePathStyle: true,
    // Новые версии SDK по умолчанию добавляют в подпись CRC32-чексумму запроса —
    // сторонние S3-хранилища (не сам AWS) её не ждут, из-за этого браузерная
    // загрузка по presigned-ссылке может упасть с ошибкой подписи. Отключаем.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: process.env.VK_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.VK_S3_SECRET_ACCESS_KEY
    }
  });

  try {
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: process.env.VK_S3_BUCKET,
        Key: objectKey,
        ContentType: contentType
      }),
      { expiresIn: UPLOAD_URL_TTL_SEC }
    );

    const viewUrl = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: process.env.VK_S3_BUCKET,
        Key: objectKey
      }),
      { expiresIn: VIEW_URL_TTL_SEC }
    );

    res.status(200).json({ uploadUrl, viewUrl, objectKey });
  } catch (err) {
    console.error("Ошибка генерации ссылки на загрузку:", err);
    res.status(500).json({ error: "presign_failed" });
  }
};
