# Valera Jets Admin CRM v2

Bu sürüm mevcut admin panelini mini private aviation CRM'e yükseltir.

## Kurulum sırası

1. **ÖNCE** Supabase > SQL Editor'da `upgrade-crm.sql` dosyasının tamamını çalıştırın.
2. SQL başarılı olduktan sonra GitHub'daki mevcut `adminvalerajets` reposunda şu dosyaları bu pakettekilerle değiştirin:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
   - `CNAME`
   - `robots.txt`
   - `.nojekyll`
3. `upgrade-crm.sql` dosyasını repoda tutabilirsiniz; web uygulaması bunu çalıştırmaz.
4. Commit sonrası GitHub Pages deploy'un tamamlanmasını bekleyin.
5. `https://admin.valerajets.com/?v=2` ile açıp hard refresh yapın.

## Yeni CRM alanları

- Human readable Lead No: `VJ-0001`
- Pipeline: New → Qualified → Sourcing → Quote Ready → Quote Sent → Client Confirmed → Payment Pending → Booked → Flown / Won / Lost
- Operator Quotes
- Client Quote versions
- Finans / gross broker revenue
- Referral fee + partner
- Follow-up planlama
- Deal timeline
- İç notlar / lead source / lost reason

## Güvenlik

- Public site ziyaretçileri flight request okumaya devam edemez.
- CRM tabloları yalnızca `is_valera_admin()` sonucu true olan authenticated kullanıcılar tarafından okunabilir/değiştirilebilir.
- `config.js` yalnızca browser-safe publishable key içerir.
- Secret/service_role key frontend'e eklenmemelidir.

## Tek onayla AOC RFQ gönderimi

RFQ otomasyonu şu akışı ekler:

`Deal → RFQ → operatörleri seç → onayla → Supabase Edge Function → Resend → ayrı e-postalar`

- Her operatör ayrı `To:` e-postası alır; diğer operatörleri göremez.
- E-posta metni uçuş kaydından sunucuda yeniden üretilir.
- Müşteri adı, telefonu ve e-postası RFQ'ya eklenmez; not içindeki iletişim bilgileri de maskelenir.
- Her gönderim `rfq_requests` tablosuna ve deal timeline'a yazılır.
- En az bir başarılı gönderimden sonra `new` / `qualified` deal otomatik `sourcing` olur.
- Aynı gönderim isteği `batch_id` ve Resend idempotency anahtarıyla yinelenmeye karşı korunur.

### Kurulum

1. Supabase SQL Editor'da `rfq-automation.sql` dosyasını çalıştırın.
2. `supabase/functions/send-rfq/index.ts` dosyasını `send-rfq` Edge Function olarak deploy edin.
3. Edge Function secrets bölümüne şunları ekleyin:
   - `RESEND_API_KEY`
   - `RFQ_FROM_EMAIL` — örnek: `Valera Jets Charter Desk <charter@rfq.valerajets.com>`
   - `RFQ_REPLY_TO` — örnek: `charter@valerajets.com`
   - `ALLOWED_ORIGIN=https://admin.valerajets.com`
4. Resend'de gönderen domaini doğrulayın.
5. Admin panelinde e-postası olan en az bir operatörü seçip test RFQ'su gönderin.

Supabase tarafından sağlanan `SUPABASE_URL`, `SUPABASE_ANON_KEY` ve
`SUPABASE_SERVICE_ROLE_KEY` Edge Function ortamında otomatik kullanılır; bunları
frontend dosyalarına yazmayın.
