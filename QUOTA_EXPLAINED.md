# 🎯 Quota System Explained

## ❓ ทำไมแสดง "2/11 วิดีโอ"?

### สถานการณ์
```
Dashboard: แสดง "2 คลิป remaining"
Account Page: แสดง "3600 units = 2 videos"
TikTok Page: เลือก 11 คลิป → แสดง "สามารถอัปโหลดได้เพียง 2/11 วิดีโอ"
```

### ✅ **นี่ไม่ใช่ Bug!**

ข้อความนี้หมายความว่า:
- **คุณเลือก 11 คลิป** TikTok ที่ต้องการอัปโหลด
- **แต่ quota เหลือแค่ 2 videos** (3,600 units)
- **ระบบเตือน** ว่าอัปได้เพียง 2 จาก 11 คลิป

---

## 📊 YouTube API Quota System

### Quota ต่อ Account
```
Daily Limit: 10,000 units
Upload Cost: 1,600 units/video
Max Uploads: 6 videos/day (10,000 / 1,600 = 6.25)
Reset: Midnight PST (8:00 UTC)
```

### ตัวอย่างการคำนวณ
```
Account "main":
- Limit: 10,000 units
- Used: 6,400 units (4 videos uploaded)
- Remaining: 3,600 units
- Can upload: 2 more videos (3,600 / 1,600 = 2.25)
```

---

## 🔍 ทำไมข้อมูลดูเหมือนขัดแย้ง?

### Case 1: เลือก TikTok 11 คลิป แต่ quota เหลือ 2
```
ผลลัพธ์: "Quota ไม่พอ — สามารถอัปโหลดได้เพียง 2/11 วิดีโอวันนี้"
```

**คำอธิบาย:**
- คุณเลือก 11 คลิป = ต้องใช้ 17,600 units (11 × 1,600)
- Account มี quota เหลือ 3,600 units = อัปได้แค่ 2 videos
- **2/11** = 2 ที่อัปได้จาก 11 ที่เลือก

### Case 2: มี 2 accounts แต่แสดงแค่ active account
```
Account A (active): 2 videos remaining
Account B (inactive): 6 videos remaining
Dashboard แสดง: 2 videos ← ถูกต้อง (แสดงแค่ active)
```

**คำอธิบาย:**
- Dashboard แสดงเฉพาะ **active account**
- ถ้าต้องการใช้ Account B → สลับ active account

---

## ✅ วิธีแก้

### 1. เลือกคลิปน้อยลง
```
แทนที่จะเลือก 11 คลิป → เลือกแค่ 2 คลิปที่ดีที่สุด
```

### 2. ใช้ Smart Upload
```
ระบบจะเลือกคลิปที่ virality score สูงที่สุดให้อัตโนมัติ
เลือก 11 คลิป → ระบบอัปแค่ 2 คลิปที่ดีที่สุด
```

### 3. สลับไปใช้ Account อื่น
```
ไปหน้า 👥 Accounts
→ กด "✅ ใช้ Account นี้" ที่ account ที่ quota ยังเหลือ
→ กลับมาหน้า TikTok อัปต่อ
```

### 4. รอ Quota Reset
```
Quota reset: เที่ยงคืน PST (8:00 น. ตามเวลาไทย)
หลัง reset: quota กลับมาเป็น 10,000 units (6 videos)
```

### 5. ขอ Extended Quota
```
Google Cloud Console → YouTube Data API v3 → Quotas
→ Request Quota Increase → 1,000,000 units/day
→ รอ Google อนุมัติ (1-3 วัน)
→ หลังได้รับ: อัปได้ 600+ videos/day
```

---

## 📈 ตัวอย่างการใช้งานจริง

### Scenario A: อัปได้พอดี
```
เลือก: 2 คลิป TikTok
Quota เหลือ: 3,600 units (2 videos)
ผลลัพธ์: ✅ อัปสำเร็จทั้ง 2 คลิป
```

### Scenario B: เลือกเยอะเกิน
```
เลือก: 11 คลิป TikTok
Quota เหลือ: 3,600 units (2 videos)
ข้อความ: ⚠️ "สามารถอัปโหลดได้เพียง 2/11 วิดีโอ"

ทางเลือก:
1. เลือกแค่ 2 คลิปที่ดีที่สุด
2. อัป 2 คลิป วันนี้ → รอ reset → อัปอีก 6 คลิป พรุ่งนี้ → รออีก → อัปอีก 3 คลิป
3. สลับ account
```

### Scenario C: Multi-Account
```
Account A: 3,600 units (2 videos) ← active
Account B: 10,000 units (6 videos)

Step 1: อัป 2 คลิปด้วย Account A
Step 2: สลับไป Account B
Step 3: อัปอีก 6 คลิป
Total: 8 videos/day!
```

---

## 🎯 Tips

### 1. เช็ค Quota ก่อนอัป
```
Dashboard → ดู "คลิปที่อัปได้วันนี้"
หรือ
Accounts → ดู "Remaining" ของ active account
```

### 2. ใช้ Virality Score
```
TikTok Page → เรียงตาม Virality Score
→ เลือกแค่คลิป 🔥 (score 75+) เมื่อ quota น้อย
```

### 3. Plan Ahead
```
มี 30 คลิปต้องอัป?
- วันนี้: อัป 6 คลิปดีที่สุด
- พรุ่งนี้: อัปอีก 6 คลิป
- วันมะรืน: อัปอีก 6 คลิป
...
5 วัน = 30 คลิป ✅
```

### 4. Multi-Account Strategy
```
2 accounts = 12 videos/day
5 accounts = 30 videos/day
10 accounts = 60 videos/day
```

---

## 🔧 Technical Details

### Quota Tracking per Account
```json
{
  "accounts": [{
    "id": "acc_xxx",
    "name": "main",
    "quotaUsed": 6400,
    "quotaLimit": 10000,
    "quotaRemaining": 3600  // = 10000 - 6400
  }],
  "activeAccountId": "acc_xxx"
}
```

### Upload Cost Calculation
```javascript
const UPLOAD_COST = 1600; // units per video

function getUploadsRemaining(quotaRemaining) {
  return Math.floor(quotaRemaining / UPLOAD_COST);
}

// Example:
getUploadsRemaining(3600) // = 2 videos
getUploadsRemaining(10000) // = 6 videos
getUploadsRemaining(1500) // = 0 videos (ไม่พอ)
```

---

## ❓ FAQ

### Q: ทำไม Dashboard แสดง 2 แต่เลือก 11 คลิป?
**A:** Dashboard แสดง quota ที่เหลือ (2 videos), 11 คลิปคือจำนวนที่คุณเลือก → เลยได้ "2/11"

### Q: ทำไมไม่แสดงรวม quota ทุก accounts?
**A:** Dashboard แสดงเฉพาะ active account เพราะระบบใช้แค่ active account อัปโหลด

### Q: ถ้าอยากอัปทั้ง 11 คลิปต้องทำยังไง?
**A:** 
1. อัป 2 คลิปวันนี้ (quota เหลือ 2)
2. รอ quota reset พรุ่งนี้ → อัปอีก 6 คลิป
3. รอพรุ่งนี้อีก → อัปอีก 3 คลิป
**หรือ** สลับไปใช้ account อื่นที่ quota ยังเหลือ

### Q: ถ้าขอ Extended Quota แล้วจะได้กี่วิดีโอ?
**A:** 1,000,000 units / 1,600 = **625 videos/day** 🚀

---

## ✅ สรุป

**ข้อความ "2/11 วิดีโอ" ไม่ใช่ bug แต่เป็น feature!**

หมายความว่า:
- ✅ Quota tracking ทำงานถูกต้อง
- ✅ ระบบเตือนว่า quota ไม่พอ
- ✅ ป้องกันไม่ให้เกิน quota limit

**ทางเลือก:**
1. เลือกคลิปน้อยลง (2 คลิป)
2. สลับ account
3. รอ quota reset
4. ขอ Extended Quota

---

**Server:** http://localhost:3000
**Accounts:** http://localhost:3000#/accounts
**TikTok:** http://localhost:3000#/tiktok
