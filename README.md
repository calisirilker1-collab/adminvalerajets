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
