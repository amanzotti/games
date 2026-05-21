import { test, expect, type Page } from "@playwright/test";
import path from "path";

const FILE_URL = `file:///${path.resolve("Princess multiplication/index.html").replace(/\\/g, "/")}?test=1`;

// --- helpers ---

async function currentAnswer(page: Page): Promise<number> {
  await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
  return page.evaluate(() => (window as any)._pmq.state.currentQuestion.answer);
}

async function clickCorrect(page: Page) {
  const ans = await currentAnswer(page);
  await page.locator(`#choices .choice-btn`).getByText(String(ans), { exact: true }).click();
}

async function clickWrong(page: Page) {
  const ans = await currentAnswer(page);
  const wrongTexts = await page.$$eval(
    "#choices .choice-btn",
    (els, a) => els.filter((e) => Number(e.textContent) !== a).map((e) => e.textContent!),
    ans
  );
  await page.locator(`#choices .choice-btn`).getByText(wrongTexts[0], { exact: true }).click();
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

/** Wait for question to advance (choiceLocked becomes false after nextQuestion renders) */
async function waitForAdvance(page: Page) {
  await page.waitForFunction(() => !(window as any)._pmq.state.choiceLocked);
}

/** Load page and wait for game JS to be ready */
async function loadGame(page: Page) {
  await page.goto(FILE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (window as any)._pmq !== undefined);
}

/** Start a game with single table, no timer */
async function startGame(page: Page, table: number) {
  await selectTable(page, table);
  await page.locator("#start-btn").click();
  await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
}

// --- tests ---

test.describe("Princess Math Quest", () => {
  test.beforeEach(async ({ page }) => {
    await loadGame(page);
    await page.evaluate(() => {
      localStorage.removeItem("pmq_mastery_v1");
      localStorage.removeItem("pmq_name");
      localStorage.removeItem("pmq_input_mode");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any)._pmq !== undefined);
  });

  // -- Welcome Screen --

  test.describe("Welcome Screen", () => {
    test("shows title and subtitle", async ({ page }) => {
      await expect(page.locator("#welcome-screen h1")).toContainText("Princess Math Quest");
      await expect(page.locator("#welcome-screen .subtitle")).toBeVisible();
    });

    test("has table buttons 2-12 plus TUTTE", async ({ page }) => {
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
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window as any)._pmq !== undefined);
      await expect(page.locator("#player-name")).toHaveValue("Giulia");
    });
  });

  // -- Single Table Mode --

  test.describe("Single Table Mode", () => {
    test("plays a single-table round with correct/wrong answers", async ({ page }) => {
      await page.fill("#player-name", "Alice");
      await startGame(page, 7);

      await expect(page.locator("#game-screen")).toBeVisible();
      await expect(page.locator("#table-title")).toContainText("7");
      await expect(page.locator("#question-text")).toHaveText(/7 \u00d7 \d+ = \?/);
      await expect(page.locator("#choices .choice-btn")).toHaveCount(4);

      // Correct answer
      await clickCorrect(page);
      await expect(page.locator("#score-label")).toContainText("1");
      await expect(page.locator("#feedback")).toHaveClass(/good/);

      // Wait for next question
      await waitForAdvance(page);
      await expect(page.locator("#question-text")).toHaveText(/7 \u00d7 \d+ = \?/);

      // Wrong answer
      await clickWrong(page);
      const feedback = await page.textContent("#feedback");
      expect(feedback).toMatch(/Quasi|risposta era/);
    });

    test("shows results after exiting early", async ({ page }) => {
      await startGame(page, 4);
      await clickCorrect(page);
      await waitForAdvance(page);
      await page.click("#exit-btn");
      await expect(page.locator("#results-screen")).toBeVisible();
      await expect(page.locator("#results-stars")).not.toBeEmpty();
    });

    test("round note shows 10 questions for single table", async ({ page }) => {
      await selectTable(page, 9);
      await expect(page.locator("#round-note")).toContainText("10 domande");
    });

    test("records mastery data for single table questions", async ({ page }) => {
      await startGame(page, 3);
      await clickCorrect(page);
      await waitForAdvance(page);
      await page.click("#exit-btn");

      const data = await page.evaluate(() => JSON.parse(localStorage.getItem("pmq_mastery_v1")!));
      expect(Object.keys(data).length).toBeGreaterThan(0);
    });
  });

  // -- All Tables (TUTTE) Mode --

  test.describe("TUTTE Mode", () => {
    test("starts with 15 adaptive questions from mixed tables", async ({ page }) => {
      await selectTable(page, 0);
      await page.locator("#start-btn").click();
      await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);

      await expect(page.locator("#table-title")).toContainText("Tutte le Tabelline");

      const seenTables = new Set<number>();
      for (let i = 0; i < 5; i++) {
        const t = await page.evaluate(() => (window as any)._pmq.state.currentQuestion.table);
        seenTables.add(t);
        await clickCorrect(page);
        await waitForAdvance(page);
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
      await page.locator("#start-btn").click();
      await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);

      const initialLen = await page.evaluate(() => (window as any)._pmq.state.questions.length);
      await clickWrong(page);
      const newLen = await page.evaluate(() => (window as any)._pmq.state.questions.length);
      expect(newLen).toBe(initialLen + 1);
    });

    test("shows session insights on results screen", async ({ page }) => {
      await selectTable(page, 0);
      await page.locator("#start-btn").click();
      await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
      await clickCorrect(page);
      await waitForAdvance(page);
      await clickWrong(page);
      await waitForAdvance(page);
      await page.click("#exit-btn");

      await expect(page.locator("#session-insights")).toBeVisible();
      const html = await page.innerHTML("#session-insights");
      expect(html).toContain("padronegiate");
    });
  });

  // -- Adaptive Algorithm --

  test.describe("Adaptive Algorithm", () => {
    test("prioritizes struggling facts", async ({ page }) => {
      await page.evaluate(() => {
        const data: Record<string, any> = {};
        data["3x7"] = { c: 1, a: 5, t: Date.now() };
        data["8x6"] = { c: 0, a: 4, t: Date.now() };
        for (let m = 1; m <= 10; m++) data[`2x${m}`] = { c: 10, a: 10, t: Date.now() };
        localStorage.setItem("pmq_mastery_v1", JSON.stringify(data));
      });
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
      await page.evaluate(() => {
        const data: Record<string, any> = {};
        for (let t = 2; t <= 12; t++)
          for (let m = 1; m <= 10; m++)
            if (t <= 10) data[`${t}x${m}`] = { c: 10, a: 10, t: Date.now() };
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

  // -- Multi-Select Tables --

  test.describe("Multi-Select Tables", () => {
    test("can select multiple tables by clicking", async ({ page }) => {
      await selectTable(page, 3);
      await selectTable(page, 5);
      await selectTable(page, 7);

      const selected = await page.$$eval(
        "#table-buttons .table-btn.selected:not(.all-mode)",
        (els) => els.map((e) => Number(e.textContent))
      );
      expect(selected.sort()).toEqual([3, 5, 7]);
    });

    test("deselects a table by clicking again", async ({ page }) => {
      await selectTable(page, 3);
      await selectTable(page, 5);
      await selectTable(page, 3);

      const selected = await page.$$eval(
        "#table-buttons .table-btn.selected:not(.all-mode)",
        (els) => els.map((e) => Number(e.textContent))
      );
      expect(selected).toEqual([5]);
    });

    test("multi-select generates questions only from chosen tables", async ({ page }) => {
      await selectTable(page, 4);
      await selectTable(page, 6);
      await page.locator("#start-btn").click();
      await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);

      await expect(page.locator("#table-title")).toContainText("4");
      await expect(page.locator("#table-title")).toContainText("6");

      for (let i = 0; i < 5; i++) {
        const t = await page.evaluate(() => (window as any)._pmq.state.currentQuestion.table);
        expect([4, 6]).toContain(t);
        await clickCorrect(page);
        await waitForAdvance(page);
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
      await selectTable(page, 0);
      await selectTable(page, 0);
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
      await page.locator("#start-btn").click();
      await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);

      const initialLen = await page.evaluate(() => (window as any)._pmq.state.questions.length);
      await clickWrong(page);
      const newLen = await page.evaluate(() => (window as any)._pmq.state.questions.length);
      expect(newLen).toBe(initialLen + 1);
    });
  });

  // -- Mastery Grid --

  test.describe("Mastery Grid", () => {
    test("renders 110 cells with correct stats", async ({ page }) => {
      await page.evaluate(() => {
        const data: Record<string, any> = {};
        data["5x3"] = { c: 5, a: 5, t: Date.now() };
        data["5x4"] = { c: 2, a: 5, t: Date.now() };
        data["5x5"] = { c: 0, a: 3, t: Date.now() };
        localStorage.setItem("pmq_mastery_v1", JSON.stringify(data));
      });

      await page.click("#mastery-btn");
      await expect(page.locator("#mastery-screen")).toBeVisible();
      await expect(page.locator(".mastery-table td")).toHaveCount(110);
      await expect(page.locator("#mastery-stats")).toContainText("1");
      await expect(page.locator("#mastery-stats")).toContainText("110");
    });

    test("back button returns to welcome", async ({ page }) => {
      await page.click("#mastery-btn");
      await expect(page.locator("#mastery-screen")).toBeVisible();
      await page.click("#mastery-back-btn");
      await expect(page.locator("#welcome-screen")).toBeVisible();
    });

    test("reset clears all data", async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem("pmq_mastery_v1", JSON.stringify({ "2x1": { c: 5, a: 5, t: Date.now() } }));
      });

      page.on("dialog", (d) => d.accept());
      await page.click("#mastery-btn");
      await expect(page.locator("#mastery-screen")).toBeVisible();
      await page.click("#mastery-reset-btn");

      const data = await page.evaluate(() => localStorage.getItem("pmq_mastery_v1"));
      expect(data).toBeNull();
    });
  });

  // -- Timer --

  test.describe("Timer", () => {
    test("no-timer mode keeps bar at 100%", async ({ page }) => {
      await selectTable(page, 2);
      await selectTimer(page, "\u221e");
      await page.locator("#start-btn").click();
      await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
      await page.waitForTimeout(1500);
      const w = await page.$eval("#timer-bar", (el) => el.style.width);
      expect(w).toBe("100%");
    });

    test("timed mode decreases the bar", async ({ page }) => {
      await selectTable(page, 2);
      await selectTimer(page, "10s");
      await page.locator("#start-btn").click();
      await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
      await page.waitForTimeout(1500);
      const w = await page.$eval("#timer-bar", (el) => parseFloat(el.style.width));
      expect(w).toBeLessThan(95);
      expect(w).toBeGreaterThan(50);
    });
  });

  // -- Mute Button --

  test.describe("Mute Button", () => {
    test("toggles between mute icons", async ({ page }) => {
      await expect(page.locator("#mute-btn")).toHaveText("\ud83d\udd07");
      await page.click("#mute-btn");
      await expect(page.locator("#mute-btn")).toHaveText("\ud83d\udd0a");
      await page.click("#mute-btn");
      await expect(page.locator("#mute-btn")).toHaveText("\ud83d\udd07");
    });
  });

  // -- No Console Errors --

  test("no console errors during gameplay", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await startGame(page, 5);
    for (let i = 0; i < 3; i++) {
      await clickCorrect(page);
      await waitForAdvance(page);
    }
    await page.click("#exit-btn");
    await expect(page.locator("#results-screen")).toBeVisible();
    await page.click("#change-table-btn");
    await expect(page.locator("#welcome-screen")).toBeVisible();
    await selectTable(page, 0);
    await page.locator("#start-btn").click();
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    await clickWrong(page);
    await waitForAdvance(page);
    await page.click("#exit-btn");
    await expect(page.locator("#results-screen")).toBeVisible();
    await page.click("#change-table-btn");
    await expect(page.locator("#welcome-screen")).toBeVisible();
    await page.click("#mastery-btn");
    await expect(page.locator("#mastery-screen")).toBeVisible();

    expect(errors).toHaveLength(0);
  });
});

// --- Typing Mode ---

test.describe("Typing Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any)._pmq !== undefined);
    await page.evaluate(() => {
      localStorage.removeItem("pmq_mastery_v1");
      localStorage.removeItem("pmq_name");
      localStorage.removeItem("pmq_input_mode");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any)._pmq !== undefined);
  });

  test("mode selector visible with two pills, choice selected by default", async ({ page }) => {
    const pills = page.locator("#mode-pill-group .mode-pill");
    await expect(pills).toHaveCount(2);
    await expect(pills.nth(0)).toHaveAttribute("data-mode", "choice");
    await expect(pills.nth(0)).toHaveClass(/selected/);
    await expect(pills.nth(1)).toHaveAttribute("data-mode", "type");
  });

  test("selecting typing mode persists preference", async ({ page }) => {
    await page.click('.mode-pill[data-mode="type"]');
    await expect(page.locator('.mode-pill[data-mode="type"]')).toHaveClass(/selected/);
    const saved = await page.evaluate(() => localStorage.getItem("pmq_input_mode"));
    expect(saved).toBe("type");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any)._pmq !== undefined);
    await expect(page.locator('.mode-pill[data-mode="type"]')).toHaveClass(/selected/);
  });

  test("typing mode shows input + OK button, hides choice grid", async ({ page }) => {
    await page.click('.mode-pill[data-mode="type"]');
    await selectTable(page, 5);
    await selectTimer(page, "\u221e");
    await page.locator("#start-btn").click();
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    await expect(page.locator("#type-area")).toBeVisible();
    await expect(page.locator("#type-input")).toBeVisible();
    await expect(page.locator("#type-submit-btn")).toBeVisible();
    await expect(page.locator("#choices")).toBeHidden();
  });

  test("correct typed answer advances + scores", async ({ page }) => {
    await page.click('.mode-pill[data-mode="type"]');
    await selectTable(page, 5);
    await selectTimer(page, "\u221e");
    await page.locator("#start-btn").click();
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    const ans = await currentAnswer(page);
    await page.fill("#type-input", String(ans));
    await page.click("#type-submit-btn");
    await waitForAdvance(page);
    const score = await page.evaluate(() => (window as any)._pmq.state.score);
    expect(score).toBe(1);
  });

  test("Enter key submits typed answer", async ({ page }) => {
    await page.click('.mode-pill[data-mode="type"]');
    await selectTable(page, 3);
    await selectTimer(page, "\u221e");
    await page.locator("#start-btn").click();
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    const ans = await currentAnswer(page);
    await page.fill("#type-input", String(ans));
    await page.locator("#type-input").press("Enter");
    await waitForAdvance(page);
    const score = await page.evaluate(() => (window as any)._pmq.state.score);
    expect(score).toBe(1);
  });

  test("first wrong typed answer lets user retry, second wrong advances", async ({ page }) => {
    await page.click('.mode-pill[data-mode="type"]');
    await selectTable(page, 5);
    await selectTimer(page, "\u221e");
    await page.locator("#start-btn").click();
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    const ans = await currentAnswer(page);
    const initialIndex = await page.evaluate(() => (window as any)._pmq.state.questionIndex);
    // First wrong
    await page.fill("#type-input", String(ans + 1));
    await page.click("#type-submit-btn");
    const sameIndex = await page.evaluate(() => (window as any)._pmq.state.questionIndex);
    expect(sameIndex).toBe(initialIndex);
    await expect(page.locator("#type-input")).toBeEnabled();
    const attempts = await page.evaluate(() => (window as any)._pmq.state.typeAttempts);
    expect(attempts).toBe(1);
    // Second wrong advances
    await page.fill("#type-input", String(ans + 2));
    await page.click("#type-submit-btn");
    await waitForAdvance(page);
    const newIndex = await page.evaluate(() => (window as any)._pmq.state.questionIndex);
    expect(newIndex).toBe(initialIndex + 1);
  });

  test("empty submit shows gentle prompt, does not advance", async ({ page }) => {
    await page.click('.mode-pill[data-mode="type"]');
    await selectTable(page, 2);
    await selectTimer(page, "\u221e");
    await page.locator("#start-btn").click();
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    const initialIndex = await page.evaluate(() => (window as any)._pmq.state.questionIndex);
    await page.click("#type-submit-btn");
    await expect(page.locator("#feedback")).toContainText("Scrivi un numero");
    const sameIndex = await page.evaluate(() => (window as any)._pmq.state.questionIndex);
    expect(sameIndex).toBe(initialIndex);
  });

  test("non-digit input is stripped", async ({ page }) => {
    await page.click('.mode-pill[data-mode="type"]');
    await selectTable(page, 4);
    await selectTimer(page, "\u221e");
    await page.locator("#start-btn").click();
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    await page.locator("#type-input").focus();
    await page.keyboard.type("abc12xyz");
    await expect(page.locator("#type-input")).toHaveValue("12");
  });
});

// --- Division / Fact-Family Mode ---

test.describe("Operation Mode (Division)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any)._pmq !== undefined);
    await page.evaluate(() => {
      localStorage.removeItem("pmq_mastery_v1");
      localStorage.removeItem("pmq_name");
      localStorage.removeItem("pmq_input_mode");
      localStorage.removeItem("pmq_operation_mode");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any)._pmq !== undefined);
  });

  test("operation selector visible with 3 pills, mult selected by default", async ({ page }) => {
    const pills = page.locator("#op-pill-group .mode-pill");
    await expect(pills).toHaveCount(3);
    await expect(pills.nth(0)).toHaveAttribute("data-op", "mult");
    await expect(pills.nth(0)).toHaveClass(/selected/);
    await expect(pills.nth(1)).toHaveAttribute("data-op", "div");
    await expect(pills.nth(2)).toHaveAttribute("data-op", "mix");
  });

  test("selecting division mode persists", async ({ page }) => {
    await page.click('.mode-pill[data-op="div"]');
    await expect(page.locator('.mode-pill[data-op="div"]')).toHaveClass(/selected/);
    const saved = await page.evaluate(() => localStorage.getItem("pmq_operation_mode"));
    expect(saved).toBe("div");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any)._pmq !== undefined);
    await expect(page.locator('.mode-pill[data-op="div"]')).toHaveClass(/selected/);
  });

  test("division mode shows division symbol in question", async ({ page }) => {
    await page.click('.mode-pill[data-op="div"]');
    await selectTable(page, 5);
    await selectTimer(page, "\u221e");
    await page.evaluate(() => (document.getElementById("start-btn") as HTMLButtonElement).click());
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    await expect(page.locator("#question-text")).toContainText("\u00f7");
    const op = await page.evaluate(() => (window as any)._pmq.state.currentQuestion.op);
    expect(op).toBe("div");
  });

  test("correct division answer scores", async ({ page }) => {
    await page.click('.mode-pill[data-op="div"]');
    await selectTable(page, 5);
    await selectTimer(page, "\u221e");
    await page.evaluate(() => (document.getElementById("start-btn") as HTMLButtonElement).click());
    await page.waitForFunction(() => (window as any)._pmq.state.currentQuestion !== null);
    await clickCorrect(page);
    await waitForAdvance(page);
    const score = await page.evaluate(() => (window as any)._pmq.state.score);
    expect(score).toBe(1);
  });

  test("mix mode produces both mult and div questions", async ({ page }) => {
    await page.click('.mode-pill[data-op="mix"]');
    await selectTable(page, 5);
    await selectTimer(page, "\u221e");
    const seenOps = await page.evaluate(() => {
      const _p = (window as any)._pmq;
      const ops = new Set();
      for (let i = 0; i < 50; i++) {
        const q = _p.makeQuestionForFact({ table: 5, multiplier: 3 });
        ops.add(q.op);
      }
      return [...ops];
    });
    expect(seenOps).toContain("mult");
    expect(seenOps).toContain("div");
  });

});
