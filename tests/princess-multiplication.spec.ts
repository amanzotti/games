import { test, expect, type Page } from "@playwright/test";
import path from "path";

const FILE_URL = `file:///${path.resolve("Princess multiplication/index.html").replace(/\\/g, "/")}`;

// ─── helpers ───────────────────────────────────────────────────────

async function currentAnswer(page: Page): Promise<number> {
  await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
  return page.evaluate(() => (window as any)._pmq.state.currentQuestion.answer);
}

async function clickCorrect(page: Page) {
  const ans = await currentAnswer(page);
  await page.click(`#choices .choice-btn:has-text("${ans}")`);
}

async function clickWrong(page: Page) {
  const ans = await currentAnswer(page);
  const wrongTexts = await page.$$eval(
    "#choices .choice-btn",
    (els, a) => els.filter((e) => Number(e.textContent) !== a).map((e) => e.textContent!),
    ans
  );
  await page.click(`#choices .choice-btn:has-text("${wrongTexts[0]}")`);
}

async function selectTable(page: Page, n: number) {
  if (n === 0) {
    await page.click(".table-btn.all-mode");
  } else {
    const btns = await page.$$("#table-buttons .table-btn:not(.all-mode)");
    for (const btn of btns) {
      if ((await btn.textContent()) === String(n)) {
        await btn.click();
        return;
      }
    }
  }
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

// ─── tests ─────────────────────────────────────────────────────────

test.describe("Princess Math Quest", () => {
  test.beforeEach(async ({ page }) => {
    // Clear saved state so tests are independent
    await page.goto(FILE_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.removeItem("pmq_mastery_v1");
      localStorage.removeItem("pmq_name");
    });
    await page.reload({ waitUntil: "networkidle" });
  });

  // ── Welcome Screen ──────────────────────────────────────────────

  test.describe("Welcome Screen", () => {
    test("shows title and subtitle", async ({ page }) => {
      await expect(page.locator("#welcome-screen h1")).toContainText("Princess Math Quest");
      await expect(page.locator("#welcome-screen .subtitle")).toBeVisible();
    });

    test("has table buttons 2–12 plus TUTTE", async ({ page }) => {
      const btns = page.locator("#table-buttons .table-btn");
      await expect(btns).toHaveCount(12);
      await expect(btns.last()).toContainText("TUTTE");
    });

    test("has 6 timer options", async ({ page }) => {
      await expect(page.locator("#timer-buttons .table-btn")).toHaveCount(6);
    });

    test("start button disabled until table selected", async ({ page }) => {
      await expect(page.locator("#start-btn")).toBeDisabled();
      await selectTable(page, 3);
      await expect(page.locator("#start-btn")).toBeEnabled();
    });

    test("mastery button is visible", async ({ page }) => {
      await expect(page.locator("#mastery-btn")).toBeVisible();
    });

    test("restores saved player name", async ({ page }) => {
      await page.evaluate(() => localStorage.setItem("pmq_name", "Giulia"));
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator("#player-name")).toHaveValue("Giulia");
    });
  });

  // ── Single Table Mode ──────────────────────────────────────────

  test.describe("Single Table Mode", () => {
    test("plays a single-table round with correct/wrong answers", async ({ page }) => {
      await page.fill("#player-name", "Alice");
      await selectTable(page, 7);
      await page.click("#start-btn");
      await page.waitForTimeout(200);

      // Game screen visible
      await expect(page.locator("#game-screen")).toBeVisible();
      await expect(page.locator("#table-title")).toContainText("7");

      // Question format
      await expect(page.locator("#question-text")).toHaveText(/7 × \d+ = \?/);

      // 4 choices
      await expect(page.locator("#choices .choice-btn")).toHaveCount(4);

      // Correct answer
      await clickCorrect(page);
      await page.waitForTimeout(100);
      await expect(page.locator("#score-label")).toContainText("1");
      await expect(page.locator("#feedback")).toHaveClass(/good/);

      // Next question
      await page.waitForTimeout(900);
      await expect(page.locator("#question-text")).toHaveText(/7 × \d+ = \?/);

      // Wrong answer
      await clickWrong(page);
      await page.waitForTimeout(100);
      const feedback = await page.textContent("#feedback");
      expect(feedback).toMatch(/Quasi|risposta era/);
    });

    test("shows results after exiting early", async ({ page }) => {
      await selectTable(page, 4);
      await page.click("#start-btn");
      await page.waitForTimeout(200);
      await clickCorrect(page);
      await page.waitForTimeout(900);
      await page.click("#exit-btn");
      await page.waitForTimeout(200);

      await expect(page.locator("#results-screen")).toBeVisible();
      await expect(page.locator("#results-stars")).not.toBeEmpty();
    });

    test("round note shows 10 questions for single table", async ({ page }) => {
      await selectTable(page, 9);
      await expect(page.locator("#round-note")).toContainText("10 domande");
    });

    test("records mastery data for single table questions", async ({ page }) => {
      await selectTable(page, 3);
      await page.click("#start-btn");
      await page.waitForTimeout(200);
      await clickCorrect(page);
      await page.waitForTimeout(900);
      await page.click("#exit-btn");

      const data = await page.evaluate(() => JSON.parse(localStorage.getItem("pmq_mastery_v1")!));
      expect(Object.keys(data).length).toBeGreaterThan(0);
    });
  });

  // ── All Tables (TUTTE) Mode ─────────────────────────────────────

  test.describe("TUTTE Mode", () => {
    test("starts with 15 adaptive questions from mixed tables", async ({ page }) => {
      await selectTable(page, 0);
      await page.click("#start-btn");
      await page.waitForTimeout(200);

      await expect(page.locator("#table-title")).toContainText("Tutte le Tabelline");

      // Question mixes different tables
      const seenTables = new Set<number>();
      for (let i = 0; i < 5; i++) {
        const t = await page.evaluate(() => (window as any)._pmq.state.currentQuestion.table);
        seenTables.add(t);
        await clickCorrect(page);
        await page.waitForTimeout(900);
      }
      expect(seenTables.size).toBeGreaterThanOrEqual(2);
    });

    test("round note shows 15 questions and mastery count", async ({ page }) => {
      await selectTable(page, 0);
      const note = await page.textContent("#round-note");
      expect(note).toMatch(/15 domande adattive/);
      expect(note).toMatch(/Padroneggi \d+\/110/);
    });

    test("re-queues wrong answers for later retry", async ({ page }) => {
      await selectTable(page, 0);
      await page.click("#start-btn");
      await page.waitForTimeout(200);

      const initialLen = await page.evaluate(() => (window as any)._pmq.state.questions.length);
      await clickWrong(page);
      await page.waitForTimeout(900);
      const newLen = await page.evaluate(() => (window as any)._pmq.state.questions.length);
      expect(newLen).toBe(initialLen + 1);
    });

    test("shows session insights on results screen", async ({ page }) => {
      await selectTable(page, 0);
      await page.click("#start-btn");
      await page.waitForTimeout(200);
      // Answer 2 questions then exit
      await clickCorrect(page);
      await page.waitForTimeout(900);
      await clickWrong(page);
      await page.waitForTimeout(900);
      await page.click("#exit-btn");
      await page.waitForTimeout(200);

      await expect(page.locator("#session-insights")).toBeVisible();
      const html = await page.innerHTML("#session-insights");
      expect(html).toContain("padronegiate");
    });
  });

  // ── Adaptive Algorithm ──────────────────────────────────────────

  test.describe("Adaptive Algorithm", () => {
    test("prioritizes struggling facts", async ({ page }) => {
      // Seed struggling data and select all tables
      await page.evaluate(() => {
        const data: Record<string, any> = {};
        data["3x7"] = { c: 1, a: 5, t: Date.now() };
        data["8x6"] = { c: 0, a: 4, t: Date.now() };
        for (let m = 1; m <= 10; m++) data[`2x${m}`] = { c: 10, a: 10, t: Date.now() };
        localStorage.setItem("pmq_mastery_v1", JSON.stringify(data));
      });
      // Select all tables so generateAdaptiveQuestions has full scope
      await selectTable(page, 0);

      const result = await page.evaluate(() => {
        const q = (window as any)._pmq.generateAdaptiveQuestions(15);
        return q.filter(
          (f: any) => (f.table === 3 && f.multiplier === 7) || (f.table === 8 && f.multiplier === 6)
        ).length;
      });
      expect(result).toBeGreaterThanOrEqual(1);
    });

    test("introduces max 4 new facts per session", async ({ page }) => {
      // Mark almost everything as mastered except 10 facts
      await page.evaluate(() => {
        const data: Record<string, any> = {};
        for (let t = 2; t <= 12; t++)
          for (let m = 1; m <= 10; m++)
            if (t <= 10) data[`${t}x${m}`] = { c: 10, a: 10, t: Date.now() };
        // 11x and 12x are "new"
        localStorage.setItem("pmq_mastery_v1", JSON.stringify(data));
      });
      await selectTable(page, 0);

      const newFacts = await page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem("pmq_mastery_v1")!);
        const q = (window as any)._pmq.generateAdaptiveQuestions(15);
        return q.filter((f: any) => !data[`${f.table}x${f.multiplier}`]).length;
      });
      expect(newFacts).toBeLessThanOrEqual(4);
    });
  });

  // ── Multi-Select Tables ──────────────────────────────────────────

  test.describe("Multi-Select Tables", () => {
    test("can select multiple tables by clicking", async ({ page }) => {
      await selectTable(page, 3);
      await selectTable(page, 5);
      await selectTable(page, 7);

      // All three should be selected
      const selected = await page.$$eval(
        "#table-buttons .table-btn.selected:not(.all-mode)",
        (els) => els.map((e) => Number(e.textContent))
      );
      expect(selected.sort()).toEqual([3, 5, 7]);
    });

    test("deselects a table by clicking again", async ({ page }) => {
      await selectTable(page, 3);
      await selectTable(page, 5);
      await selectTable(page, 3); // deselect

      const selected = await page.$$eval(
        "#table-buttons .table-btn.selected:not(.all-mode)",
        (els) => els.map((e) => Number(e.textContent))
      );
      expect(selected).toEqual([5]);
    });

    test("multi-select generates questions only from chosen tables", async ({ page }) => {
      await selectTable(page, 4);
      await selectTable(page, 6);
      await page.click("#start-btn");
      await page.waitForTimeout(200);

      // Title shows selected tables
      await expect(page.locator("#table-title")).toContainText("4");
      await expect(page.locator("#table-title")).toContainText("6");

      // Play 5 questions — all should be from table 4 or 6
      for (let i = 0; i < 5; i++) {
        const t = await page.evaluate(() => (window as any)._pmq.state.currentQuestion.table);
        expect([4, 6]).toContain(t);
        await clickCorrect(page);
        await page.waitForTimeout(900);
      }
    });

    test("round note shows selected tables and scaled question count", async ({ page }) => {
      await selectTable(page, 3);
      await selectTable(page, 8);
      await selectTable(page, 11);
      const note = await page.textContent("#round-note");
      expect(note).toMatch(/3, 8, 11/);
      expect(note).toMatch(/15 domande/);
    });

    test("TUTTE selects all 11 tables", async ({ page }) => {
      await selectTable(page, 0);
      const selectedCount = await page.$$eval(
        "#table-buttons .table-btn.selected:not(.all-mode)",
        (els) => els.length
      );
      expect(selectedCount).toBe(11);
      const allSelected = await page.$eval(".table-btn.all-mode", (el) =>
        el.classList.contains("selected")
      );
      expect(allSelected).toBe(true);
    });

    test("TUTTE toggle deselects all", async ({ page }) => {
      await selectTable(page, 0); // select all
      await selectTable(page, 0); // deselect all
      const selectedCount = await page.$$eval(
        "#table-buttons .table-btn.selected",
        (els) => els.length
      );
      expect(selectedCount).toBe(0);
      await expect(page.locator("#start-btn")).toBeDisabled();
    });

    test("re-queues wrong answers in multi-select mode", async ({ page }) => {
      await selectTable(page, 3);
      await selectTable(page, 5);
      await page.click("#start-btn");
      await page.waitForTimeout(200);

      const initialLen = await page.evaluate(() => (window as any)._pmq.state.questions.length);
      await clickWrong(page);
      await page.waitForTimeout(900);
      const newLen = await page.evaluate(() => (window as any)._pmq.state.questions.length);
      expect(newLen).toBe(initialLen + 1);
    });
  });

  // ── Mastery Grid ────────────────────────────────────────────────

  test.describe("Mastery Grid", () => {
    test("renders 110 cells with correct stats", async ({ page }) => {
      // Seed some data
      await page.evaluate(() => {
        const data: Record<string, any> = {};
        data["5x3"] = { c: 5, a: 5, t: Date.now() };
        data["5x4"] = { c: 2, a: 5, t: Date.now() };
        data["5x5"] = { c: 0, a: 3, t: Date.now() };
        localStorage.setItem("pmq_mastery_v1", JSON.stringify(data));
      });

      await page.click("#mastery-btn");
      await page.waitForTimeout(200);

      await expect(page.locator("#mastery-screen")).toBeVisible();
      await expect(page.locator(".mastery-table td")).toHaveCount(110);
      await expect(page.locator("#mastery-stats")).toContainText("1");
      await expect(page.locator("#mastery-stats")).toContainText("110");
    });

    test("back button returns to welcome", async ({ page }) => {
      await page.click("#mastery-btn");
      await page.waitForTimeout(200);
      await page.click("#mastery-back-btn");
      await page.waitForTimeout(200);
      await expect(page.locator("#welcome-screen")).toBeVisible();
    });

    test("reset clears all data", async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem("pmq_mastery_v1", JSON.stringify({ "2x1": { c: 5, a: 5, t: Date.now() } }));
      });

      page.on("dialog", (d) => d.accept());
      await page.click("#mastery-btn");
      await page.waitForTimeout(200);
      await page.click("#mastery-reset-btn");
      await page.waitForTimeout(200);

      const data = await page.evaluate(() => localStorage.getItem("pmq_mastery_v1"));
      expect(data).toBeNull();
    });
  });

  // ── Timer ───────────────────────────────────────────────────────

  test.describe("Timer", () => {
    test("no-timer mode keeps bar at 100%", async ({ page }) => {
      await selectTable(page, 2);
      await selectTimer(page, "∞");
      await page.click("#start-btn");
      await page.waitForTimeout(200);
      await expect(page.locator("#timer-bar")).toHaveCSS("width", /./);
      await page.waitForTimeout(1500);
      const w = await page.$eval("#timer-bar", (el) => el.style.width);
      expect(w).toBe("100%");
    });

    test("timed mode decreases the bar", async ({ page }) => {
      await selectTable(page, 2);
      await selectTimer(page, "10s");
      await page.click("#start-btn");
      await page.waitForTimeout(1500);
      const w = await page.$eval("#timer-bar", (el) => parseFloat(el.style.width));
      expect(w).toBeLessThan(95);
      expect(w).toBeGreaterThan(50);
    });
  });

  // ── Mute Button ─────────────────────────────────────────────────

  test.describe("Mute Button", () => {
    test("toggles between 🔇 and 🔊", async ({ page }) => {
      await expect(page.locator("#mute-btn")).toHaveText("🔇");
      await page.click("#mute-btn");
      await expect(page.locator("#mute-btn")).toHaveText("🔊");
      await page.click("#mute-btn");
      await expect(page.locator("#mute-btn")).toHaveText("🔇");
    });
  });

  // ── No Console Errors ──────────────────────────────────────────

  test("no console errors during gameplay", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await selectTable(page, 5);
    await page.click("#start-btn");
    await page.waitForTimeout(200);
    for (let i = 0; i < 3; i++) {
      await clickCorrect(page);
      await page.waitForTimeout(900);
    }
    await page.click("#exit-btn");
    await page.waitForTimeout(200);
    await page.click("#change-table-btn");
    await page.waitForTimeout(200);
    await selectTable(page, 0);
    await page.click("#start-btn");
    await page.waitForTimeout(200);
    await clickWrong(page);
    await page.waitForTimeout(900);
    await page.click("#exit-btn");
    await page.waitForTimeout(200);
    await page.click("#change-table-btn");
    await page.waitForTimeout(200);
    await page.click("#mastery-btn");
    await page.waitForTimeout(200);

    expect(errors).toHaveLength(0);
  });
});
