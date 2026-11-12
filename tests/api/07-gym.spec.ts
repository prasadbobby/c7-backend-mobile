import { USERS, daysAgo, today } from "../fixtures";
import { expect, test } from "./_setup";

const PDF = "data:application/pdf;base64," + Buffer.from("%PDF-1.4\n%test report\n").toString("base64");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.describe.serial("guests, packages & enquiries", () => {
  let pkgId = "";
  let enquiryId = "";

  test("admin creates packages (online + offline); validation applies", async ({ as }) => {
    const admin = await as("admin");
    expect((await (await as("member")).post("/v1/admin/packages", { data: {} })).status()).toBe(403);
    expect((await admin.post("/v1/admin/packages", { data: { name: "X", mode: "OFFLINE", durationDays: 30, price: 100, offerPrice: 200 } })).status()).toBe(400);
    const r = await admin.post("/v1/admin/packages", { data: { name: "Transform 90", mode: "OFFLINE", durationDays: 90, price: 45000, offerPrice: 40000, features: ["Personal coach", "Diet plan"], highlight: true, sortOrder: 1 } });
    expect(r.status()).toBe(201);
    pkgId = (await r.json()).id;
    await admin.post("/v1/admin/packages", { data: { name: "Online Coaching", mode: "ONLINE", durationDays: 30, price: 6000, features: ["Weekly check-ins"], sortOrder: 2 } });
    await admin.post("/v1/admin/packages", { data: { name: "Hidden draft", mode: "ONLINE", durationDays: 30, price: 1, isActive: false } });
  });

  test("a self-signed-up user is a guest: sees packages, nothing else", async ({ as }) => {
    const guest = await as("guest");
    const me = await (await guest.get("/v1/me")).json();
    expect(me.user.access).toBe("GUEST");
    const p = await (await guest.get("/v1/packages")).json();
    expect(p.packages.map((x: { name: string }) => x.name)).toEqual(["Transform 90", "Online Coaching"]);
    expect(p.packages[0]).toMatchObject({ mode: "OFFLINE", offerPrice: 40000, perMonth: 13333, features: ["Personal coach", "Diet plan"] });
    expect((await (await guest.get("/v1/packages?mode=ONLINE")).json()).packages).toHaveLength(1);
    for (const path of ["/v1/dashboard", "/v1/workouts/assigned", "/v1/notifications", "/v1/attendance", "/v1/reports", "/v1/bmi"]) {
      const r = await guest.get(path);
      expect(r.status(), path).toBe(403);
      expect((await r.json()).code).toBe("MEMBERS_ONLY");
    }
  });

  test("guest enquires about a package (deduped); admin sees it with a NEW badge", async ({ as }) => {
    const guest = await as("guest");
    const admin = await as("admin");
    expect((await guest.post("/v1/enquiries", { data: { packageId: pkgId, phone: "abc" } })).status()).toBe(400);
    const r = await guest.post("/v1/enquiries", { data: { packageId: pkgId, phone: "+91 98400 12345", message: "Mornings please" } });
    expect(r.status()).toBe(201);
    enquiryId = (await r.json()).enquiry.id;
    expect((await (await guest.post("/v1/enquiries", { data: { packageId: pkgId } })).json()).duplicate).toBe(true);
    expect((await (await guest.get(`/v1/packages/${pkgId}`)).json()).enquiry.status).toBe("NEW");
    const list = await (await admin.get("/v1/admin/enquiries?status=OPEN")).json();
    expect(list.newCount).toBe(1);
    expect(list.enquiries[0]).toMatchObject({ packageName: "Transform 90", phone: "+91 98400 12345", person: { name: "Gary Guest" } });
    expect((await (await admin.get("/v1/admin/badges")).json()).newEnquiries).toBe(1);
    const people = await (await admin.get("/v1/admin/people")).json();
    expect(people.people.find((p: { userId: string }) => p.userId === USERS.guest.userId).isGuest).toBe(true);
    expect((await admin.patch(`/v1/admin/enquiries/${enquiryId}`, { data: { status: "CONTACTED" } })).ok()).toBeTruthy();
  });

  test("admin converts the enquiry → guest becomes an active member with the package's dates", async ({ as }) => {
    const admin = await as("admin");
    const r = await admin.post(`/v1/admin/enquiries/${enquiryId}/convert`, { data: { startDate: today() } });
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).membership).toMatchObject({ status: "ACTIVE", price: 40000 });
    const guest = await as("guest");
    expect((await (await guest.get("/v1/me")).json()).user).toMatchObject({ access: "MEMBER", membershipStatus: "ACTIVE" });
    expect((await guest.get("/v1/dashboard")).status()).toBe(200);
    expect((await (await admin.get(`/v1/admin/enquiries?status=CONVERTED`)).json()).enquiries).toHaveLength(1);
  });

  test("packages with history are archived, unused ones deleted", async ({ as }) => {
    const admin = await as("admin");
    expect((await (await admin.delete(`/v1/admin/packages/${pkgId}`)).json()).archived).toBe(true);
    const all = await (await admin.get("/v1/admin/packages")).json();
    const draft = all.packages.find((p: { name: string }) => p.name === "Hidden draft");
    expect((await (await admin.delete(`/v1/admin/packages/${draft.id}`)).json()).archived).toBe(false);
    expect((await (await (await as("member")).get("/v1/packages")).json()).packages.map((p: { name: string }) => p.name)).toEqual(["Online Coaching"]);
  });
});

test.describe.serial("expired package locks the app (renew only)", () => {
  test("expired member: profile, packages and invoices work; training features are locked", async ({ as }) => {
    const ex = await as("expired");
    expect((await (await ex.get("/v1/me")).json()).user.access).toBe("EXPIRED");
    expect((await ex.get("/v1/packages")).ok()).toBeTruthy();
    expect((await ex.get("/v1/invoices")).ok()).toBeTruthy();
    const r = await ex.get("/v1/dashboard");
    expect(r.status()).toBe(423);
    expect((await r.json()).code).toBe("MEMBERSHIP_EXPIRED");
  });
});

test.describe.serial("payments: invoices, monthly overview, reminders", () => {
  let invoiceId = "";
  test("admin generates an invoice from a recorded payment (numbered, paid, tax backed out)", async ({ as }) => {
    const admin = await as("admin");
    const month = daysAgo(80).slice(0, 7);
    const mo = await (await admin.get(`/v1/admin/payments/monthly?month=${month}`)).json();
    const pay = mo.payments.find((p: { userId: string }) => p.userId === USERS.member.userId);
    expect(pay).toMatchObject({ amount: 30000, invoice: null });
    const r = await admin.post(`/v1/admin/invoices/from-payment/${pay.id}`, { data: { taxPercent: 18 } });
    expect(r.status()).toBe(201);
    const j = await r.json();
    expect(j.number).toMatch(/^C7-\d{4}-0001$/);
    invoiceId = j.id;
    expect((await admin.post(`/v1/admin/invoices/from-payment/${pay.id}`, { data: {} })).status()).toBe(400);
    const inv = (await (await admin.get(`/v1/admin/invoices/${invoiceId}`)).json()).invoice;
    expect(inv).toMatchObject({ status: "PAID", total: 30000, subtotal: 25423.73, taxPercent: 18, billTo: { name: "Emma Richardson", memberId: "C70001" } });
  });

  test("manual invoice: partial payment → PARTIAL, then settled → PAID; member sees own invoices only", async ({ as }) => {
    const admin = await as("admin");
    const r = await admin.post("/v1/admin/invoices", { data: { userId: USERS.member.userId, description: "Personal training add-on", subtotal: 10000, taxPercent: 18, discount: 1000, amountPaid: 5000, dueDate: today() } });
    const { id, number } = await r.json();
    expect(number).toMatch(/-0002$/);
    const inv = (await (await admin.get(`/v1/admin/invoices/${id}`)).json()).invoice;
    expect(inv).toMatchObject({ taxAmount: 1620, total: 10620, status: "PARTIAL", balance: 5620 });
    const member = await as("member");
    const mine = await (await member.get("/v1/invoices")).json();
    expect(mine.invoices).toHaveLength(2);
    expect(mine.totals.due).toBe(5620);
    expect((await (await as("buddy")).get(`/v1/invoices/${id}`)).status()).toBe(404);
    await admin.patch(`/v1/admin/invoices/${id}`, { data: { amountPaid: 10620 } });
    expect((await (await member.get(`/v1/invoices/${id}`)).json()).invoice.status).toBe("PAID");
  });

  test("payment reminder lands in the member's announcements and notifications", async ({ as }) => {
    const admin = await as("admin");
    const mo = await (await admin.get(`/v1/admin/payments/monthly?month=${today().slice(0, 7)}`)).json();
    expect(mo.summary.outstanding).toBeGreaterThan(0);
    expect((await admin.post(`/v1/admin/payments/remind/${USERS.buddy.userId}`, { data: { kind: "PAYMENT" } })).status()).toBe(201);
    const buddy = await as("buddy");
    const a = await (await buddy.get("/v1/announcements")).json();
    expect(a.announcements[0]).toMatchObject({ title: "Payment reminder", kind: "PAYMENT", personal: true, read: false });
    const otherSees = (await (await (await as("member")).get("/v1/announcements")).json()).announcements.some((x: { title: string }) => x.title === "Payment reminder");
    expect(otherSees).toBe(false);
    const n = await (await buddy.get(`/v1/notifications?date=${today()}`)).json();
    expect(n.notifications.some((x: { title: string; kind: string }) => x.title === "Payment reminder" && x.kind === "payment")).toBe(true);
  });
});

test.describe.serial("attendance", () => {
  test("admin marks the day in bulk; member sees month, rate and streak", async ({ as }) => {
    const admin = await as("admin");
    const day = await (await admin.get(`/v1/admin/attendance?date=${today()}`)).json();
    expect(day.members.some((m: { userId: string }) => m.userId === USERS.member.userId)).toBe(true);
    expect(day.members.some((m: { userId: string }) => m.userId === USERS.admin.userId)).toBe(false);
    for (const [d, s] of [[daysAgo(2), "PRESENT"], [daysAgo(1), "PRESENT"], [today(), "PRESENT"]] as const) {
      expect((await admin.put("/v1/admin/attendance", { data: { date: d, entries: [{ userId: USERS.member.userId, status: s }, { userId: USERS.buddy.userId, status: d === today() ? "ABSENT" : "PRESENT" }] } })).ok()).toBeTruthy();
    }
    const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    expect((await admin.put("/v1/admin/attendance", { data: { date: tomorrow, entries: [{ userId: USERS.member.userId, status: "PRESENT" }] } })).status()).toBe(400);
    const after = await (await admin.get(`/v1/admin/attendance?date=${today()}`)).json();
    expect(after.stats).toMatchObject({ present: 1, absent: 1 });
    const mine = await (await (await as("member")).get(`/v1/attendance?month=${today().slice(0, 7)}`)).json();
    expect(mine.stats.streak).toBe(3);
    expect(mine.days.at(-1)).toMatchObject({ date: today(), status: "PRESENT" });
    expect((await (await (await as("buddy")).get("/v1/attendance")).json()).stats.streak).toBe(0);
    // Clearing a mark removes it.
    await admin.put("/v1/admin/attendance", { data: { date: today(), entries: [{ userId: USERS.buddy.userId, status: null }] } });
    expect((await (await admin.get(`/v1/admin/attendance?date=${today()}`)).json()).stats.absent).toBe(0);
    const sum = await (await admin.get(`/v1/admin/attendance/summary?month=${today().slice(0, 7)}`)).json();
    expect(sum.members[0].present).toBeGreaterThanOrEqual(1);
  });
});

test.describe.serial("announcements", () => {
  test("audiences: members, guests, all; pinned first; expired hidden; read tracking", async ({ as }) => {
    const admin = await as("admin");
    const mk = (data: object) => admin.post("/v1/admin/announcements", { data });
    await mk({ title: "Diwali timings", body: "Open 6–11am on Diwali.", kind: "CLOSURE", audience: "ALL" });
    await mk({ title: "Members-only workshop", body: "Mobility clinic Saturday.", kind: "EVENT", audience: "MEMBERS", pinned: true });
    await mk({ title: "Guest offer", body: "10% off your first package.", kind: "OFFER", audience: "GUESTS" });
    await mk({ title: "Old news", body: "Gone.", audience: "ALL", expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect((await mk({ title: "For one", body: "x", audience: "USER" })).status()).toBe(400);

    const member = await as("member");
    const m = await (await member.get("/v1/announcements")).json();
    expect(m.announcements.map((a: { title: string }) => a.title).slice(0, 2)).toEqual(["Members-only workshop", "Diwali timings"]);
    expect(m.announcements.some((a: { title: string }) => a.title === "Guest offer" || a.title === "Old news")).toBe(false);
    expect((await member.post(`/v1/announcements/${m.announcements[0].id}/read`)).ok()).toBeTruthy();
    const m2 = await (await member.get("/v1/announcements")).json();
    expect(m2.unread).toBe(m.unread - 1);
    await member.post("/v1/announcements/read-all");
    expect((await (await member.get("/v1/announcements")).json()).unread).toBe(0);

    const ex = await as("expired");
    expect((await (await ex.get("/v1/announcements")).json()).announcements.some((a: { title: string }) => a.title === "Diwali timings")).toBe(true);
    const list = await (await admin.get("/v1/admin/announcements")).json();
    expect(list.announcements.find((a: { title: string }) => a.title === "Members-only workshop").reads).toBe(1);
  });
});

test.describe.serial("medical reports", () => {
  test("member uploads a PDF; coach adds one; member can't delete the coach's", async ({ as }) => {
    const member = await as("member");
    const admin = await as("admin");
    expect((await member.post("/v1/reports", { data: { title: "Thing", fileUrl: "data:text/plain;base64,aGk=", reportDate: today() } })).status()).toBe(400);
    const r = await member.post("/v1/reports", { data: { title: "Lipid profile", category: "BLOOD", fileUrl: PDF, reportDate: daysAgo(3), notes: "Fasting" } });
    expect(r.status()).toBe(201);
    const mine = (await r.json()).id;
    const c = await admin.post(`/v1/admin/members/${USERS.member.userId}/reports`, { data: { title: "Posture assessment", category: "FITNESS", fileUrl: PNG, reportDate: today() } });
    const coachId = (await c.json()).id;
    const list = await (await member.get("/v1/reports")).json();
    expect(list.reports.map((x: { title: string; byCoach: boolean }) => [x.title, x.byCoach])).toEqual([["Posture assessment", true], ["Lipid profile", false]]);
    expect(list.reports[1]).toMatchObject({ fileType: "application/pdf" });
    expect((await (await member.get(`/v1/reports/${mine}`)).json()).report.fileUrl).toBe(PDF);
    expect((await (await as("buddy")).get(`/v1/reports/${mine}`)).status()).toBe(404);
    expect((await member.delete(`/v1/reports/${coachId}`)).status()).toBe(403);
    expect((await member.delete(`/v1/reports/${mine}`)).ok()).toBeTruthy();
    expect((await (await admin.get(`/v1/admin/members/${USERS.member.userId}/reports`)).json()).reports).toHaveLength(1);
  });
});

test.describe.serial("workout videos", () => {
  test("admin uploads a video file + publishes; members list by category; drafts hidden", async ({ as, baseURL }) => {
    const admin = await as("admin");
    const up = await admin.post("/v1/admin/videos/upload", { multipart: { file: { name: "squat.mp4", mimeType: "video/mp4", buffer: Buffer.from("fake-mp4-bytes") } } });
    expect(up.status()).toBe(201);
    const { url, sizeBytes } = await up.json();
    expect(url).toMatch(/\/files\/videos\/.+\.mp4$/);
    const file = await (await as("member")).get(url.replace(/^https?:\/\/[^/]+/, baseURL ?? ""));
    expect(file.ok()).toBeTruthy();
    expect((await file.body()).toString()).toBe("fake-mp4-bytes");
    expect((await admin.post("/v1/admin/videos/upload", { multipart: { file: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("x") } } })).status()).toBe(400);
    await admin.post("/v1/admin/videos", { data: { title: "Goblet squat", category: "strength", videoUrl: url, sizeBytes, durationSec: 45, isAnimated: true } });
    await admin.post("/v1/admin/videos", { data: { title: "Draft clip", category: "strength", videoUrl: url, isPublished: false } });
    expect((await admin.post("/v1/admin/videos", { data: { title: "Bad", category: "strength", videoUrl: "ftp://x" } })).status()).toBe(400);
    const v = await (await (await as("member")).get("/v1/videos?category=strength")).json();
    expect(v.videos.map((x: { title: string }) => x.title)).toEqual(["Goblet squat"]);
    expect(v.videos[0]).toMatchObject({ isAnimated: true, durationSec: 45, sizeBytes: 14 });
  });
});

test.describe.serial("BMI, monthly history & check-up reminders", () => {
  test("BMI from latest weight/height, month-wise history, coach-set next check-up → reminder", async ({ as }) => {
    const buddy = await as("buddy");
    const admin = await as("admin");
    for (const [d, w] of [[daysAgo(65), 72], [daysAgo(35), 70], [daysAgo(1), 68.5]] as const) {
      expect((await buddy.post("/v1/measurements", { data: { measurementType: "WEIGHT", value: w, unit: "kg", recordedDate: d } })).ok()).toBeTruthy();
    }
    const b = await (await buddy.get("/v1/bmi")).json();
    expect(b).toMatchObject({ height: 168, weight: 68.5, bmi: 24.3, category: { key: "OVER", label: "Overweight" }, healthyWeight: { min: 52.2, max: 64.6 } });
    expect(b.history.length).toBeGreaterThanOrEqual(2);
    expect(b.history.at(-1)).toMatchObject({ weight: 68.5, bmi: 24.3 });
    expect(b.checkup).toMatchObject({ setByCoach: false, intervalDays: 30 });

    const soon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    expect((await admin.put(`/v1/admin/members/${USERS.buddy.userId}/checkup`, { data: { nextDate: soon, intervalDays: 30, notes: "Bring body-fat scan" } })).ok()).toBeTruthy();
    const b2 = await (await buddy.get("/v1/bmi")).json();
    expect(b2.checkup).toMatchObject({ setByCoach: true, notes: "Bring body-fat scan", overdue: false });
    const n = await (await buddy.get(`/v1/notifications?date=${today()}`)).json();
    expect(n.notifications.some((x: { kind: string }) => x.kind === "checkup")).toBe(true);
  });
});

test.describe.serial("photos", () => {
  test("progress photos (own only) and meal photos on logged meals", async ({ as }) => {
    const member = await as("member");
    const r = await member.post("/v1/progress-photos", { data: { imageUrl: PNG, pose: "FRONT", takenAt: today(), weight: 49 } });
    expect(r.status()).toBe(201);
    const id = (await r.json()).id;
    expect((await (await member.get("/v1/progress-photos")).json()).photos[0]).toMatchObject({ pose: "FRONT", weight: 49 });
    expect((await (await as("buddy")).delete(`/v1/progress-photos/${id}`)).status()).toBe(404);
    expect((await member.delete(`/v1/progress-photos/${id}`)).ok()).toBeTruthy();

    const m = await member.post("/v1/nutrition/meals", { data: { date: today(), slot: "LUNCH", name: "Thali", kcal: 650, protein: 22, photoUrl: PNG } });
    expect(m.status()).toBe(201);
    const meal = (await m.json()).summary.meals.find((x: { name: string }) => x.name === "Thali");
    expect(meal.photoUrl).toBe(PNG);
  });
});
