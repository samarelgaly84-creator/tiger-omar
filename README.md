# TIGER — Connect. Share. Create. Store. Discover.

منصة تواصل اجتماعي وتقنية متكاملة تجمع بين الشبكة الاجتماعية، المحادثات الفورية المشفرة، الفيديوهات القصيرة، البث المباشر عبر WebRTC، التخزين السحابي، والذكاء الاصطناعي.

## الوحدات الرئيسية

- **TIGER SOCIAL & STORIES**: منشورات متعددة الأنواع (نصوص، صور، ألبومات، فيديو، PDF، روابط، استطلاعات رأي، بطاقات ملونة)، تفاعلات، تعليقات متداخلة، مسودات، وقصص يومية تختفي بعد 24 ساعة.
- **TIGER REELS**: فيديوهات قصيرة عمودية بتشغيل تلقائي وإعجابات وتعليقات وحفظ.
- **TIGER LIVE**: بث مباشر عبر WebRTC مع دردشة وتفاعلات فورية وحفظ التسجيل.
- **TIGER CHAT**: محادثات فردية وجماعية عبر WebSockets، رسائل صوتية، مشاركة موقع، مكالمات صوت وفيديو WebRTC، وتشفير طرف لطرف (WebCrypto ECDH P-256 + AES-GCM-256).
- **TIGER CLOUD & DRIVE AI**: تخزين سحابي حقيقي على الخادم مع حصص مساحة، مجلدات، سلة محذوفات، روابط مشاركة مؤمنة، وتحليل المستندات (تلخيص، أسئلة وأجوبة، اختبارات، بحث ذكي) بعد التحقق من الصلاحيات.
- **TIGER AI**: مساعد ذكي مدعوم بـ Gemini (`gemini-4-hydrogen`) + توليد الصور (`gemini-3.1-flash-lite-image`).
- **TIGER FRIENDS / GROUPS / PAGES / PROFILE / NOTIFICATIONS / PREMIUM / ADMIN**.

## التشغيل المحلي

```bash
npm install
npm run dev
```

## متغيرات البيئة المطلوبة (`.env.example`)

- `GEMINI_API_KEY`: مفتاح Gemini API (لتشغيل TIGER AI و TIGER DRIVE AI).
- `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`: بيانات الاتصال بقاعدة بيانات PostgreSQL (Cloud SQL).
- `TIGER_ADMIN_EMAILS`: بريد أو أكثر بصلاحية مدير النظام (مفصولة بفاصلة).
- `STRIPE_SECRET_KEY`: (اختياري) لربط بوابة الدفع الحية.

## البناء والإنتاج

```bash
npm run build
npm start
```
