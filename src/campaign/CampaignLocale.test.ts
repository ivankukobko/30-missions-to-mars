import { describe, it, expect, afterEach } from 'vitest';
import {
  getCampaignBundle,
  getMissionOverlay,
  getEpilogueOverlay,
  getDefaultGoal,
} from './CampaignLocale.ts';
import {
  MISSIONS,
  EPILOGUE,
  PROLOGUE,
  resolveBriefCards,
  resolvePayloadName,
  missionGoal,
  resolveDebrief,
  resolveDebriefSender,
  debriefLine,
  resolveRadioCall,
  resolveEpilogueCards,
} from './Missions.ts';
import type { LandingScore } from './Progress.ts';
import { i18n, SUPPORTED_LOCALES } from '../i18n/I18n.ts';

/**
 * What each language file has to agree with, rather than what it says.
 *
 * Nothing here quotes a line. The copy is still being rewritten, and a test that pins a
 * sentence fails on every edit while catching nothing an edit can break. What an edit can
 * break is structure: a brief card dropped or split, a `{CENTILE}` translated into a word,
 * a debrief variant left out so that one language answers an S-rank with the standard line.
 *
 * Two references. `missions.yaml` decides how many cards and calls a mission has and whose
 * each one is. English decides which debriefs, variants, goals and tokens exist, because
 * it is the language every other one falls back to — so every other language is held to it.
 */

const LOCALES = SUPPORTED_LOCALES.map((l) => l.code);
/** Languages held to English: a gap in one of these shows the player English. */
const TRANSLATIONS = LOCALES.filter((code) => code !== 'en');

/** The `{TOKEN}`s a line carries, order-free. */
const tokens = (line: string | undefined) => (line?.match(/\{[A-Z]+\}/g) ?? []).sort();
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const english = (missionId: number) => getMissionOverlay(missionId, 'en');

const landing = (rank: LandingScore['rank'], points = 54): LandingScore => ({
  rank,
  points,
  fuelPct: 0.4,
  touchdownSpeed: 1,
  offset: 0,
});

afterEach(() => {
  i18n.setLocale('en');
});

describe('English, the language every other one falls back to', () => {
  it('has words for every card, call and epilogue card the mission table holds', () => {
    // A gap here is not an English problem: it is a blank on screen in every language.
    for (const m of MISSIONS) {
      const words = english(m.id);
      expect(words?.payloadName, `mission ${m.id} payloadName`).toBeTruthy();
      expect(words?.messages?.length ?? 0, `mission ${m.id} cards`).toBe(m.messages.length);
      m.messages.forEach((_, i) => {
        expect(words?.messages?.[i]?.sender, `mission ${m.id} card ${i} sender`).toBeTruthy();
        expect(words?.messages?.[i]?.content, `mission ${m.id} card ${i}`).toBeTruthy();
      });
      expect(words?.radio?.length ?? 0, `mission ${m.id} calls`).toBe(m.radio?.length ?? 0);
      (m.radio ?? []).forEach((_, i) => {
        expect(words?.radio?.[i]?.content, `mission ${m.id} call ${i}`).toBeTruthy();
      });
      if (m.messages.length) expect(words?.goal, `mission ${m.id} goal`).toBeTruthy();
    }
    expect(getEpilogueOverlay('en')?.length).toBe(EPILOGUE.length);
    getEpilogueOverlay('en')?.forEach((card, i) => {
      expect(card.sender, `epilogue ${i} sender`).toBeTruthy();
      expect(card.content, `epilogue ${i}`).toBeTruthy();
    });
    expect(getCampaignBundle('en').defaultGoal).toBeTruthy();
  });
});

describe('every language file agrees with missions.yaml', () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      it('never adds, drops or splits a brief card, a radio call or an epilogue card', () => {
        for (const m of MISSIONS) {
          const o = getMissionOverlay(m.id, locale);
          if (o?.messages) expect(o.messages.length, `mission ${m.id} cards`).toBe(m.messages.length);
          if (o?.radio) expect(o.radio.length, `mission ${m.id} calls`).toBe(m.radio?.length ?? 0);
        }
        const epilogue = getEpilogueOverlay(locale);
        if (epilogue) expect(epilogue.length).toBe(EPILOGUE.length);
      });

      it('never crams a card', () => {
        // The cap `Missions.test.ts` holds English to, held in every language. A sentence
        // runs longer in German or Ukrainian than in English, so a translated card is where
        // it overflows first — mission 5's second card did, by one character, while the
        // English-only check passed.
        for (const m of MISSIONS) {
          for (const card of resolveBriefCards(m, locale)) {
            expect(visible(card.body).length, `mission ${m.id}, card "${card.title}"`).toBeLessThan(240);
          }
        }
        for (const card of resolveEpilogueCards(locale)) {
          expect(visible(card.content).length, `epilogue "${card.sender}"`).toBeLessThan(240);
        }
      });

      it('states every goal as plain text, word for word inside its own brief', () => {
        // The rule `missionGoal` used to keep by scanning the brief for a marker, kept here
        // instead: the goal readout says the sentence the employer already said, in the
        // language the player is reading it in.
        for (const m of MISSIONS) {
          const goal = missionGoal(m, locale);
          expect(goal, `mission ${m.id}`).toMatch(/^[^<>]+$/);
          if (m.messages.length === 0) continue;
          const brief = resolveBriefCards(m, locale).map((c) => visible(c.body)).join(' ');
          expect(brief, `mission ${m.id}`).toContain(goal);
        }
      });
    });
  }

  for (const locale of TRANSLATIONS) {
    describe(`${locale}, held to English`, () => {
      it('is its own file, rather than quietly resolving to English', () => {
        expect(getCampaignBundle(locale)).not.toBe(getCampaignBundle('en'));
      });

      it('authors exactly the debriefs and variants English does', () => {
        for (const m of MISSIONS) {
          const theirs = english(m.id)?.debrief;
          const own = getMissionOverlay(m.id, locale)?.debrief;
          expect(own !== undefined, `mission ${m.id} debrief`).toBe(theirs !== undefined);
          if (!theirs || !own) continue;
          expect(own.strong !== undefined, `mission ${m.id} strong`).toBe(theirs.strong !== undefined);
          expect(own.weak !== undefined, `mission ${m.id} weak`).toBe(theirs.weak !== undefined);
        }
      });

      it('keeps every {TOKEN} English has, and invents none', () => {
        for (const m of MISSIONS) {
          const own = getMissionOverlay(m.id, locale);
          const theirs = english(m.id);
          if (!own || !theirs) continue;
          own.messages?.forEach((card, i) => {
            expect(tokens(card.content), `mission ${m.id} card ${i}`).toEqual(tokens(theirs.messages?.[i]?.content));
          });
          own.radio?.forEach((call, i) => {
            expect(tokens(call.content), `mission ${m.id} call ${i}`).toEqual(tokens(theirs.radio?.[i]?.content));
          });
          for (const variant of ['content', 'strong', 'weak'] as const) {
            if (own.debrief?.[variant] === undefined) continue;
            expect(tokens(own.debrief[variant]), `mission ${m.id} debrief ${variant}`).toEqual(
              tokens(theirs.debrief?.[variant]),
            );
          }
        }
        getEpilogueOverlay(locale)?.forEach((card, i) => {
          expect(tokens(card.content), `epilogue ${i}`).toEqual(tokens(getEpilogueOverlay('en')?.[i]?.content));
        });
      });

      it('translates every mission, card, call, debrief and epilogue card', () => {
        for (const m of MISSIONS) {
          const own = getMissionOverlay(m.id, locale);
          const theirs = english(m.id);
          expect(own, `mission ${m.id}`).toBeDefined();
          expect(own!.payloadName, `mission ${m.id} payloadName`).toBeTruthy();
          if (m.messages.length) expect(own!.messages?.length, `mission ${m.id} cards`).toBe(m.messages.length);
          if (m.radio?.length) expect(own!.radio?.length, `mission ${m.id} calls`).toBe(m.radio.length);
          if (theirs?.debrief) expect(own!.debrief?.content, `mission ${m.id} debrief`).toBeTruthy();
          if (theirs?.goal) expect(own!.goal, `mission ${m.id} goal`).toBeTruthy();
        }
        expect(getEpilogueOverlay(locale)?.length).toBe(EPILOGUE.length);
        expect(getCampaignBundle(locale).defaultGoal).toBeTruthy();
      });
    });
  }
});

describe('resolving a mission in a language', () => {
  it("wears the livery and register the mission table authors, whatever the language", () => {
    for (const locale of LOCALES) {
      for (const m of MISSIONS) {
        expect(resolveBriefCards(m, locale).map((c) => c.from), `${locale} mission ${m.id}`).toEqual(
          m.messages.map((slot) => slot.from),
        );
      }
      expect(
        resolveEpilogueCards(locale).map((c) => [c.from ?? null, c.register ?? null]),
        locale,
      ).toEqual(EPILOGUE.map((slot) => [slot.from ?? null, slot.register ?? null]));
    }
  });

  it('never moves a radio call, changes whose colour it wears, or gives Helion a header', () => {
    for (const locale of LOCALES) {
      for (const m of MISSIONS) {
        (m.radio ?? []).forEach((trigger, i) => {
          const { atAltitude, atSeconds, corp, sender } = resolveRadioCall(m, i, locale);
          expect(
            { atAltitude, atSeconds, corp, headed: sender !== undefined },
            `${locale} mission ${m.id} call ${i}`,
          ).toEqual({
            atAltitude: trigger.atAltitude,
            atSeconds: trigger.atSeconds,
            corp: trigger.corp,
            // `Radio.show` draws no header only for `undefined`; an empty string is a blank bar.
            headed: Boolean(english(m.id)?.radio?.[i]?.sender),
          });
        });
      }
    }
  });

  it("answers a rank with the variant English authors, in the language's words", () => {
    for (const locale of LOCALES) {
      for (const m of MISSIONS) {
        const theirs = english(m.id)?.debrief;
        if (!theirs) continue;
        const own = getMissionOverlay(m.id, locale)?.debrief;
        const expected = (variant: 'content' | 'strong' | 'weak', points: number) =>
          (own?.[variant] ?? theirs[variant]!).replace('{CENTILE}', i18n.formatOrdinal(points, locale));

        const cases = [
          [landing('S', 91), expected(theirs.strong ? 'strong' : 'content', 91)],
          [landing('B', 54), expected('content', 54)],
          [landing('C', 12), expected(theirs.weak ? 'weak' : 'content', 12)],
        ] as const;
        for (const [score, line] of cases) {
          const said = debriefLine(m, score, locale);
          expect(said, `${locale} mission ${m.id} rank ${score.rank}`).toBe(line);
          expect(said, `${locale} mission ${m.id} rank ${score.rank}`).not.toMatch(/\{[A-Z]+\}/);
        }
      }
    }
  });

  it('reads the active language when none is passed', () => {
    const m = MISSIONS.find((x) => resolveDebrief(x) && x.radio?.length && x.messages.length)!;
    for (const locale of LOCALES) {
      i18n.setLocale(locale);
      expect(resolveBriefCards(m), locale).toEqual(resolveBriefCards(m, locale));
      expect(resolvePayloadName(m), locale).toBe(resolvePayloadName(m, locale));
      expect(missionGoal(m), locale).toBe(missionGoal(m, locale));
      expect(resolveDebriefSender(m), locale).toBe(resolveDebriefSender(m, locale));
      expect(debriefLine(m, landing('B')), locale).toBe(debriefLine(m, landing('B'), locale));
      expect(resolveRadioCall(m, 0), locale).toEqual(resolveRadioCall(m, 0, locale));
      expect(resolveEpilogueCards(), locale).toEqual(resolveEpilogueCards(locale));
    }
  });

  it('treats a language it has no file for as English', () => {
    for (const m of MISSIONS) {
      expect(resolveBriefCards(m, 'fr'), `mission ${m.id}`).toEqual(resolveBriefCards(m, 'en'));
    }
  });

  it('gives the prologue the default goal in every language, since its brief is empty by design', () => {
    for (const locale of LOCALES) {
      expect(missionGoal(PROLOGUE, locale), locale).toBe(getDefaultGoal(locale));
    }
  });
});
