#!/usr/bin/env python3
"""Python Decimal test oracle for @cursebound/numeric (REQ NUM01, PRD section 11.2).

Emits JSON fixtures (canonical string form, e.g. '1.75e2' or '0') for a deterministic list of operations,
computed with the stdlib decimal module at 34 significant digits, ROUND_HALF_EVEN and enlarged exponent
limits (decimal.MAX_EMAX / MIN_EMIN = +/-(10**18 - 1), the largest the C implementation accepts).

Semantics mirrored from the TypeScript implementation:
  * inputs are rounded to 34 digits on construction (ctx.create_decimal)
  * every operation result is rounded half-even to 34 significant digits (Decimal does this natively)
  * sub floors at zero
  * pow uses right-to-left binary exponentiation rounding every multiplication; negative n -> 1 / x**|n|

Usage:
  py -I tools/balance/oracle/numeric_oracle.py > tests/fixtures/numeric_oracle.json
  py -I tools/balance/oracle/numeric_oracle.py tests/fixtures/numeric_oracle.json   (writes UTF-8, no BOM)
"""
import decimal
import json
import random
import sys
from decimal import Decimal

PREC = 34
CTX = decimal.Context(
    prec=PREC,
    rounding=decimal.ROUND_HALF_EVEN,
    Emax=decimal.MAX_EMAX,
    Emin=decimal.MIN_EMIN,
    capitals=1,
    clamp=0,
    flags=[],
    traps=[decimal.InvalidOperation, decimal.DivisionByZero, decimal.Overflow, decimal.Underflow],
)
decimal.setcontext(CTX)
ONE = Decimal(1)


def D(s):
    """Construct a decimal from text, rounded to context precision (like Big.from)."""
    return CTX.create_decimal(s)


def canon(d):
    """Canonical string: '0' or '<m>e<e>' with m = d[.ddd] trailing zeros trimmed, e = leading-digit exponent."""
    if d.is_zero():
        return '0'
    sign, digits, exp = d.as_tuple()
    assert sign == 0, 'negative value in oracle'
    s = ''.join(str(x) for x in digits)
    lead = exp + len(s) - 1
    s = s.rstrip('0')
    m = s if len(s) == 1 else s[0] + '.' + s[1:]
    return '%se%d' % (m, lead)


def powint(x, n):
    if n == 0:
        return ONE
    neg = n < 0
    n = -n if neg else n
    result = ONE
    base = x
    while True:
        if n & 1:
            result = CTX.multiply(result, base)
        n >>= 1
        if n == 0:
            break
        base = CTX.multiply(base, base)
    if neg:
        result = CTX.divide(ONE, result)
    return result


def sub_floor(a, b):
    r = CTX.subtract(a, b)
    return Decimal(0) if r <= 0 else r


def cmp(a, b):
    return (a > b) - (a < b)


def rand_dec(rng, emin, emax, ndig=None):
    if ndig is None:
        ndig = rng.choice([1, 2, 3, 5, 9, 17, 25, 33, 34, 34, 34, 34])
    coef = rng.randrange(10 ** (ndig - 1), 10 ** ndig)
    lead = rng.randint(emin, emax)
    return D('%de%d' % (coef, lead - ndig + 1))


def rand_exp_range(rng):
    r = rng.random()
    if r < 0.6:
        return (-40, 40)
    if r < 0.85:
        return (-5000, 5000)
    return (-10 ** 15, 10 ** 15)


def main():
    rng = random.Random(20261013)
    cases = []

    def add_case(op, r, **kw):
        c = {'op': op}
        c.update(kw)
        c['r'] = r
        cases.append(c)

    # ---- from: raw text rounded to 34 digits (half-even on the 35th digit) ----
    raw_from = [
        '0', '123', '1.75', '0.05', '1e450', '1.2345e-7', '2.5E+10', '1.18', '1000000',
        '12345678901234567890123456789012345',      # 35 digits, last 5 -> tie, 34th digit 4 even -> down
        '12345678901234567890123456789012335',      # tie, 34th digit 3 odd -> up
        '12345678901234567890123456789012345000001',  # above tie -> up
        '99999999999999999999999999999999995',      # tie with carry to 1e35
        '99999999999999999999999999999999994999',   # below tie
        '0.000000000000000000000000000000000000000000123456789012345678901234567890123456789',
        '1.0000000000000000000000000000000005',     # tie, 34th digit 0 even -> 1
        '1.0000000000000000000000000000000015',     # tie, 34th digit 1 odd -> up
        '1.00000000000000000000000000000000050000000001',
        '7.10e1000000', '3.3e-999999',
    ]
    for _ in range(30):
        nd = rng.randint(35, 60)
        s = str(rng.randrange(10 ** (nd - 1), 10 ** nd))
        pos = rng.randint(1, len(s))
        txt = s[:pos] + ('.' + s[pos:] if pos < len(s) else '') + 'e%d' % rng.randint(-60, 60)
        raw_from.append(txt)
    for s in raw_from:
        add_case('from', canon(D(s)), a=s)

    # ---- mul ----
    for _ in range(400):
        lo, hi = rand_exp_range(rng)
        a = rand_dec(rng, lo, hi)
        b = rand_dec(rng, lo, hi)
        add_case('mul', canon(CTX.multiply(a, b)), a=canon(a), b=canon(b))
    # ---- div ----
    for _ in range(400):
        lo, hi = rand_exp_range(rng)
        a = rand_dec(rng, lo, hi)
        b = rand_dec(rng, lo, hi)
        add_case('div', canon(CTX.divide(a, b)), a=canon(a), b=canon(b))
    for a, b in [('1', '3'), ('2', '3'), ('1', '7'), ('10', '4'), ('1', '1.18'), ('9.999999999999999999999999999999999', '3')]:
        add_case('div', canon(CTX.divide(D(a), D(b))), a=canon(D(a)), b=canon(D(b)))

    # ---- add / sub with aligned and nearly aligned exponents ----
    for _ in range(500):
        lo, hi = rand_exp_range(rng)
        a = rand_dec(rng, lo, hi)
        lead_a = a.adjusted()
        b = rand_dec(rng, lead_a - rng.randint(0, 40), lead_a - 0)
        if rng.random() < 0.5:
            a, b = b, a
        add_case('add', canon(CTX.add(a, b)), a=canon(a), b=canon(b))
        add_case('sub', canon(sub_floor(a, b)), a=canon(a), b=canon(b))
        add_case('sub', canon(sub_floor(b, a)), a=canon(b), b=canon(a))
    # cancellation-heavy subtraction
    for _ in range(200):
        lo, hi = rand_exp_range(rng)
        a = rand_dec(rng, lo, hi, 34)
        sign, digits, exp = a.as_tuple()
        coef = int(''.join(str(x) for x in digits))
        delta = rng.randrange(1, 10 ** rng.randint(1, 33))
        b = D('%de%d' % (max(coef - delta, 1), exp))
        add_case('sub', canon(sub_floor(a, b)), a=canon(a), b=canon(b))
        add_case('add', canon(CTX.add(a, b)), a=canon(a), b=canon(b))
    # explicit half-even ties at the 34th digit
    ties = [
        ('1e33', '0.5'), ('1e33', '1.5'), ('1e33', '2.5'), ('1.000000000000000000000000000000001e33', '0.5'),
        ('9.999999999999999999999999999999999e33', '0.5'), ('9.999999999999999999999999999999999e33', '0.4'),
        ('9.999999999999999999999999999999999e33', '0.6'), ('9.999999999999999999999999999999998e33', '0.5'),
        ('1', '5e-34'), ('1', '1.5e-33'), ('1', '5e-35'), ('1', '5.000000000000000000000000000000001e-34'),
        ('1e40', '1'), ('1e40', '5e5'), ('1e40', '5e6'), ('1e40', '5.000000000000000000000000000000001e6'),
    ]
    for a, b in ties:
        add_case('add', canon(CTX.add(D(a), D(b))), a=canon(D(a)), b=canon(D(b)))
        add_case('sub', canon(sub_floor(D(a), D(b))), a=canon(D(a)), b=canon(D(b)))

    # ---- pow ----
    pows = [
        ('1.18', 9999), ('1.18', 10000), ('1.18', 200000), ('1.18', -9999), ('1.12', 9999), ('1.75', 3), ('0.7', 3),
        ('1.08', 12345), ('7.1', 1200000), ('1.000001', 1000000), ('0.5', 1000), ('2', 64), ('2', 128), ('2', -1),
        ('3', -20), ('1.4', 77), ('9.99', 1000003), ('1.0000000000000000000000000000000001', 10 ** 12),
        ('1.000000000000000000000000000000001', 123456789), ('0.999', 1000000), ('1.18', 1),
    ]
    for _ in range(40):
        a = rand_dec(rng, -3, 3)
        n = rng.randint(-500, 5000)
        pows.append((canon(a), n))
    for a, n in pows:
        add_case('pow', canon(powint(D(a), n)), a=canon(D(a)), n=str(n))

    # ---- cmp ----
    for _ in range(150):
        lo, hi = rand_exp_range(rng)
        a = rand_dec(rng, lo, hi)
        b = rand_dec(rng, lo, hi) if rng.random() < 0.7 else (a if rng.random() < 0.5 else rand_dec(rng, a.adjusted(), a.adjusted(), 34))
        add_case('cmp', cmp(a, b), a=canon(a), b=canon(b))

    out = {
        'generator': 'tools/balance/oracle/numeric_oracle.py',
        'python_decimal': decimal.__version__,
        'precision': PREC,
        'rounding': 'ROUND_HALF_EVEN',
        'emax': CTX.Emax,
        'emin': CTX.Emin,
        'pow_algorithm': 'right-to-left binary exponentiation, rounding each multiply; negative n -> 1/x**|n|',
        'count': len(cases),
        'cases': cases,
    }
    # one case per line: diff-friendly and compact
    head = json.dumps({k: v for k, v in out.items() if k != 'cases'}, indent=1, ensure_ascii=True)[:-2]
    lines = ',\n'.join('  ' + json.dumps(c, ensure_ascii=True, separators=(',', ':')) for c in cases)
    data = (head + ',\n "cases": [\n' + lines + '\n ]\n}\n').encode('utf-8')
    json.loads(data)  # self-check
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'wb') as f:
            f.write(data)
    else:
        sys.stdout.buffer.write(data)
        sys.stdout.flush()


if __name__ == '__main__':
    main()
