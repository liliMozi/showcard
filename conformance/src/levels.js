/**
 * Conformance level determination (specification section 9.1).
 *
 * Section 9.1 is really two ladders in one table. Hosts are graded L0 to L3;
 * cards are graded by the L0 harmlessness test of section 9.2, which is a
 * property of a *file*, not of a program. So the verdict is reported in two
 * parts and never mixed: `card.l0` and `host.l1` answer different questions
 * about different artefacts.
 *
 * L2 (gateway) and L3 (full host) are not automated here, and the answer for
 * them is the string `not-automated` — never a pass. L2 needs a host that will
 * execute a binding under a stated domain policy and query/remember
 * per-(kind, subject) authorization, letting a suite watch; L3 needs pin/Fork
 * semantics and authorization-lifecycle management (revocation) driven
 * through a real user gesture. Neither has a hook a card can reach, which is
 * exactly the point of them, so a suite that reported them as passing would
 * be reporting on nothing.
 */

/** The verdict for a level with no automated judgment behind it. */
export const NOT_AUTOMATED = 'not-automated';

function assertShape(value, name, check, expected) {
  if (!check(value)) {
    throw new TypeError(`determineLevels needs ${name} to be ${expected}`);
  }
}

/**
 * Grade a card and a host from the three suite results.
 *
 * All three are required. There is no partial run: a missing result would have
 * to be scored as either a pass or a fail, and both would be a lie about work
 * that was never done.
 *
 * @param {object} results
 * @param {{ findings: Array }} results.staticResult from `checkCardDocument`
 * @param {{ pass: boolean }} results.l0Result from `runL0Harmlessness`
 * @param {{ pass: boolean }} results.hostResult from `runHostSuite`
 * @returns {{ card: { l0: string }, host: { l1: string, l2: string, l3: string } }}
 */
export function determineLevels(results) {
  assertShape(results, 'its argument', (value) => value && typeof value === 'object', 'an object');
  const { staticResult, l0Result, hostResult } = results;

  assertShape(
    staticResult,
    'staticResult',
    (value) => value && Array.isArray(value.findings),
    'a checkCardDocument result with a findings array',
  );
  assertShape(
    l0Result,
    'l0Result',
    (value) => value && typeof value.pass === 'boolean',
    'a runL0Harmlessness result with a boolean pass',
  );
  assertShape(
    hostResult,
    'hostResult',
    (value) => value && typeof value.pass === 'boolean',
    'a runHostSuite result with a boolean pass',
  );

  // Warnings do not fail a card: the natural-language title rule and the
  // declared-width band are SHOULD-level, and grading a SHOULD as a failure
  // would put the specification's own words in the wrong register.
  const staticClean = !staticResult.findings.some((finding) => finding.level === 'error');

  return {
    card: { l0: staticClean && l0Result.pass ? 'pass' : 'fail' },
    host: {
      l1: hostResult.pass ? 'pass' : 'fail',
      l2: NOT_AUTOMATED,
      l3: NOT_AUTOMATED,
    },
  };
}
