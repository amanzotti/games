import { test, expect, type Page } from "@playwright/test";
import path from "path";

const FILE_URL = `file:///${path.resolve("Bosco dei numeri/index.html").replace(/\\/g, "/")}?test=1`;

// --- helpers ---

async function currentAnswer(page: Page): Promise<number> {
  await page.waitForFunction(() => (window as any)._bdn.state.currentQuestion !== null);
  return page.evaluate(() => (window as any)._bdn.state.currentQuestion.answer);
}

async function clickCorrect(page: Page) {
  const ans = await currentAnswer(page);
  await page.locator(`#choices .choice-btn`).getByText(String(ans), { exact: true }).click();
}

async function clickWrong(page: Page) {
  const ans = await currentAnswer(page);
  const wrongTexts = await page.$$eval(
    "#choices .choice-btn",
    (els, a) => els.filter(e => Number(e.textContent) !== a).map(e => e.textContent!),
    ans
  );
  await page.locator(`#choices .choice-btn`).getByText(wrongTexts[0], { exact: true }).click();
}

async function selectLevel(page: Page, id: number) {
  const btns = await page.$$("#level-buttons .table-btn");
  for (const btn of btns) {
    if ((await btn.getAttribute("data-level-id")) === String(id)) {
      await btn.click();
      return;
    }
  }
  throw new Error(`Level ${id} not found`);
}

async function selectTimer(page: Page, label: string) {
  const btns = await page.$$("#timer-buttons .table-btn");
  for (const btn of btns) {
    if ((await btn.textContent()) === label) {
      await btn.click();
      return;
    }
  }
}

/** Wait for question to advance (choiceLocked becomes false after nextQuestion renders) */
async function waitForAdvance(page: Page) {
  await page.waitForFunction(() => !(window as any)._bdn.state.choiceLocked);
}

/** Load page and wait for game JS to be ready */
async function loadGame(page: Page) {
  await page.goto(FILE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any)._bdn !== undefined);
}

/** Start a game with defaults: level 1, no timer */
async function startGame(page: Page) {
  await selectLevel(page, 1);
  await selectTimer(page, "\u221e");
  await page.locator("#start-btn").click();
  await page.waitForFunction(() => (window as any)._bdn.state.currentQuestion !== null);
}

// --- tests ---

test.describe("Bosco dei Numeri", () => {
  test.beforeEach(async ({ page }) => {
    await loadGame(page);
    await page.evaluate(() => {
      localStorage.removeItem("bdn_mastery_v1");
      localStorage.removeItem("bdn_name");
      localStorage.removeItem("bdn_op_mode");
      localStorage.removeItem("bdn_input_mode");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any)._bdn !== undefined);
  });

  // -- Welcome Screen --

  test.describe("Welcome Screen", () => {
    test("shows title and subtitle", async ({ page }) => {
      await expect(page.locator("#welcome-screen h1")).toContainText("Bosco dei Numeri");
      await expect(page.locator("#welcome-screen .subtitle")).toBeVisible();
    });

    test("has 3 level buttons", async ({ page }) => {
      await expect(page.locator("#level-buttons .table-btn")).toHaveCount(3);
    });

    test("has 4 timer options", async ({ page }) => {
      await expect(page.locator("#timer-buttons .table-btn")).toHaveCount(4);
    });

    test("has 3 operation pills (add default selected)", async ({ page }) => {
      const pills = page.locator("#op-pill-group .mode-pill");
      await expect(pills).toHaveCount(3);
      await expect(pills.nth(0)).toHaveAttribute("data-op", "add");
      await expect(pills.nth(0)).toHaveClass(/selected/);
    });

    test("has 2 input mode pills (choice default)", async ({ page }) => {
      const pills = page.locator("#mode-pill-group .mode-pill");
      await expect(pills).toHaveCount(2);
      await expect(pills.nth(0)).toHaveClass(/selected/);
    });

    test("start button disabled until level selected", async ({ page }) => {
      await expect(page.locator("#start-btn")).toBeDisabled();
      await selectLevel(page, 1);
      await expect(page.locator("#start-btn")).toBeEnabled();
    });

    test("mastery button is visible", async ({ page }) => {
      await expect(page.locator("#mastery-btn")).toBeVisible();
    });

    test("restores saved player name", async ({ page }) => {
      await page.evaluate(() => localStorage.setItem("bdn_name", "Virgi"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window as any)._bdn !== undefined);
      await expect(page.locator("#player-name")).toHaveValue("Virgi");
    });
  });

  // -- Operation Mode --

  test.describe("Operation Mode", () => {
    test("selecting subtraction persists", async ({ page }) => {
      await page.click('.mode-pill[data-op="sub"]');
      await expect(page.locator('.mode-pill[data-op="sub"]')).toHaveClass(/selected/);
      const saved = await page.evaluate(() => localStorage.getItem("bdn_op_mode"));
      expect(saved).toBe("sub");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window as any)._bdn !== undefined);
      await expect(page.locator('.mode-pill[data-op="sub"]')).toHaveClass(/selected/);
    });

    test("addition mode produces + questions", async ({ page }) => {
      await startGame(page);
      const q = await page.evaluate(() => (window as any)._bdn.state.currentQuestion);
      expect(q.op).toBe("add");
      expect(q.display).toContain("+");
    });

    test("mix mode generates both ops over many trials", async ({ page }) => {
      const seen = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        _b.state.operationMode = "mix";
        const ops = new Set();
        const level = _b.LEVELS[1];
        for (let i = 0; i < 60; i++) {
          const q = _b.makeQuestion(level);
          ops.add(q.op);
        }
        return [...ops];
      });
      expect(seen).toContain("add");
      expect(seen).toContain("sub");
    });
  });

  // -- Levels --

  test.describe("Levels", () => {
    test("level 1 caps sums at 10", async ({ page }) => {
      const sums = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        const level = _b.LEVELS[0];
        const all: number[] = [];
        for (let i = 0; i < 80; i++) {
          const q = _b.makeAdditionQuestion(level);
          all.push(q.a + q.b);
        }
        return all;
      });
      expect(sums.every(s => s <= 10)).toBe(true);
    });

    test("level 2 includes sums up to 20", async ({ page }) => {
      const maxSum = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        const level = _b.LEVELS[1];
        let m = 0;
        for (let i = 0; i < 100; i++) {
          const q = _b.makeAdditionQuestion(level);
          m = Math.max(m, q.a + q.b);
        }
        return m;
      });
      expect(maxSum).toBeGreaterThan(10);
      expect(maxSum).toBeLessThanOrEqual(20);
    });

    test("level 3 only generates cross-decade addition (sum > 10)", async ({ page }) => {
      const sums = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        const level = _b.LEVELS[2];
        const all: number[] = [];
        for (let i = 0; i < 60; i++) {
          const q = _b.makeAdditionQuestion(level);
          all.push(q.a + q.b);
        }
        return all;
      });
      expect(sums.every(s => s > 10)).toBe(true);
    });

    test("subtraction at level 3 crosses 10 (minuend > 10, answer < 10)", async ({ page }) => {
      const facts = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        const level = _b.LEVELS[2];
        const all: { m: number; a: number }[] = [];
        for (let i = 0; i < 60; i++) {
          const q = _b.makeSubtractionQuestion(level);
          all.push({ m: q.minuend, a: q.answer });
        }
        return all;
      });
      expect(facts.every(f => f.m > 10 && f.a < 10)).toBe(true);
    });
  });

  // -- Multiple choice gameplay --

  test.describe("Multiple-choice gameplay", () => {
    test("renders 4 choices", async ({ page }) => {
      await startGame(page);
      await expect(page.locator("#choices .choice-btn")).toHaveCount(4);
    });

    test("wrong answer keeps score at 0 and shows feedback", async ({ page }) => {
      await startGame(page);
      await clickWrong(page);
      await expect(page.locator("#feedback")).toContainText("Quasi");
      const score = await page.evaluate(() => (window as any)._bdn.state.score);
      expect(score).toBe(0);
    });

    test("wrong answers re-queue the fact later", async ({ page }) => {
      await startGame(page);
      const initialLen = await page.evaluate(() => (window as any)._bdn.state.questions.length);
      await clickWrong(page);
      const newLen = await page.evaluate(() => (window as any)._bdn.state.questions.length);
      expect(newLen).toBe(initialLen + 1);
    });
  });

  // -- Typing mode --

  test.describe("Typing mode", () => {
    test("toggling typing mode shows input area", async ({ page }) => {
      await page.click('.mode-pill[data-mode="type"]');
      await startGame(page);
      await expect(page.locator("#type-area")).toBeVisible();
      await expect(page.locator("#choices")).toBeHidden();
    });

    test("Enter key submits correct typed answer", async ({ page }) => {
      await page.click('.mode-pill[data-mode="type"]');
      await startGame(page);
      const ans = await currentAnswer(page);
      await page.fill("#type-input", String(ans));
      await page.locator("#type-input").press("Enter");
      await waitForAdvance(page);
      const score = await page.evaluate(() => (window as any)._bdn.state.score);
      expect(score).toBe(1);
    });

    test("first wrong typed answer lets retry, second advances", async ({ page }) => {
      await page.click('.mode-pill[data-mode="type"]');
      await startGame(page);
      const ans = await currentAnswer(page);
      const startIdx = await page.evaluate(() => (window as any)._bdn.state.questionIndex);
      // First wrong
      await page.fill("#type-input", String(ans + 1));
      await page.click("#type-submit-btn");
      const sameIdx = await page.evaluate(() => (window as any)._bdn.state.questionIndex);
      expect(sameIdx).toBe(startIdx);
      const attempts = await page.evaluate(() => (window as any)._bdn.state.typeAttempts);
      expect(attempts).toBe(1);
      // Second wrong advances
      await page.fill("#type-input", String(ans + 2));
      await page.click("#type-submit-btn");
      await waitForAdvance(page);
      const newIdx = await page.evaluate(() => (window as any)._bdn.state.questionIndex);
      expect(newIdx).toBeGreaterThanOrEqual(startIdx + 1);
    });

    test("non-digit input is stripped", async ({ page }) => {
      await page.click('.mode-pill[data-mode="type"]');
      await startGame(page);
      await page.locator("#type-input").focus();
      await page.keyboard.type("abc7xyz");
      await expect(page.locator("#type-input")).toHaveValue("7");
    });
  });

  // -- Mastery --

  test.describe("Mastery", () => {
    test("correct addition answer is recorded in mastery", async ({ page }) => {
      await startGame(page);
      const key = await page.evaluate(() => (window as any)._bdn.state.currentQuestion.recordKey);
      await clickCorrect(page);
      await waitForAdvance(page);
      const mastery = await page.evaluate(() => JSON.parse(localStorage.getItem("bdn_mastery_v1") || "{}"));
      expect(mastery[key]).toBeTruthy();
      expect(mastery[key].c).toBeGreaterThanOrEqual(1);
    });

    test("addition fact key normalizes operand order (canonical)", async ({ page }) => {
      const sameKey = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        return _b.factKey("add", 7, 3) === _b.factKey("add", 3, 7);
      });
      expect(sameKey).toBe(true);
    });

    test("mastery screen shows addition grid by default", async ({ page }) => {
      await page.click("#mastery-btn");
      await expect(page.locator("#mastery-grid")).toBeVisible();
      await expect(page.locator("#mastery-grid .mastery-cell")).toHaveCount(121);
    });

    test("mastery view can switch to subtraction", async ({ page }) => {
      await page.click("#mastery-btn");
      await page.click('.mode-pill[data-mastery-op="sub"]');
      const count = await page.locator("#mastery-grid .mastery-cell").count();
      expect(count).toBeGreaterThan(50);
    });
  });

  // -- Pedagogy --

  test.describe("Pedagogy", () => {
    test("all addition facts are valid (a+b=sum)", async ({ page }) => {
      const ok = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        return _b.ALL_ADD_FACTS.every((f: any) => f.a + f.b === f.sum);
      });
      expect(ok).toBe(true);
    });

    test("all subtraction facts are valid (m-s=a)", async ({ page }) => {
      const ok = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        return _b.ALL_SUB_FACTS.every((f: any) => f.minuend - f.subtrahend === f.answer);
      });
      expect(ok).toBe(true);
    });

    test("subtraction never produces negative answers", async ({ page }) => {
      const minAns = await page.evaluate(() => {
        const _b = (window as any)._bdn;
        return Math.min(..._b.ALL_SUB_FACTS.map((f: any) => f.answer));
      });
      expect(minAns).toBeGreaterThanOrEqual(0);
    });
  });

  // -- No console errors --

  test("no console errors during a full play session", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
    await loadGame(page);
    await startGame(page);
    for (let i = 0; i < 5; i++) {
      await clickCorrect(page);
      await waitForAdvance(page);
    }
    await page.click("#exit-btn");
    await expect(page.locator("#welcome-screen")).toBeVisible();
    await page.click("#mastery-btn");
    await expect(page.locator("#mastery-grid")).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
