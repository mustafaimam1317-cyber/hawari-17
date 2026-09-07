# دليل تشغيل وربط Cloudflare Worker بمنصة Hawari 🚀

هذا الدليل يشرح في **دقيقتين فقط** كيف تقوم بتشغيل الـ Cloudflare Worker لربطه بدومينك والاستفادة من سرعة الـ Edge والترافيك المجاني غير المحدود.

---

## الخطوات من خلال لوحة تحكم Cloudflare Dashboard (طريقة سهلة بالمتصفح):

### 1️⃣ إنشاء الـ Worker:
1. ادخل على حسابك في [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. من القائمة الجانبية، اضغط على **Compute (Workers & Pages)** ثم اضغط **Create application**.
3. اختر تبويب **Workers** ثم اضغط **Create Worker**.
4. اختر اسماً للـ Worker (مثلاً: `hawari-edge-proxy`).
5. اضغط **Deploy**.

---

### 2️⃣ وضع الكود:
1. بعد الـ Deploy، اضغط على **Edit code** في أعلى اليمين.
2. احذف الكود الافتراضي، وانسخ بالكامل محتوى ملف `cloudflare/worker.js`.
3. اضغط **Deploy** لحفظ الكود ونشره فوراً.

---

### 3️⃣ ربط الـ Worker بدومينك (Custom Domain أو Route):
بما أن دومينك مربوط بـ Cloudflare، لديك خياران ممتازان:

* **الخيار الأول (موصى به - Custom Subdomain):**
  1. ادخل داخل الـ Worker -> تبويب **Settings** -> **Triggers**.
  2. في قسم **Custom Domains**، اضغط **Add Custom Domain**.
  3. اكتب مثلاً: `api.yourdomain.com` (استبدل `yourdomain.com` بدومين موقعك).
  4. سيقوم Cloudflare تلقائياً بتهيئة شهادة SSL وربط الدومين بالـ Worker خلال 30 ثانية مجاناً!

* **الخيار الثاني (عبر Route على نفس الدومين):**
  1. في نفس تبويب **Triggers**، في قسم **Routes** اضغط **Add route**.
  2. اكتب: `yourdomain.com/supabase-proxy/*`
  3. اختر اسم الـ Zone (الدومين الخاص بك).
  4. اضغط Save.

---

### 4️⃣ التحقق من العمل:
عند فتح الرابط في المتصفح أو إرسال طلب، ستجد في رأس الاستجابة (Headers):
`CF-Cache-Status: HIT` أو `MISS`  
و `X-Hawari-Edge: EDGE-CACHE-HIT`  
وهذا يعني أن طلبات بنك الأسئلة والنتائج يتم إرجاعها الآن بسرعة البرق وبـ **0 بايت ترافيك على Supabase**!
