package runner

import "strings"

// QuoteEnvValue renders a value in the one grammar every reader of a Bay .env
// file agrees on: systemd's double-quoted EnvironmentFile form.
//
// Values used to be written raw, which three readers then disagreed about.
// systemd's EnvironmentFile parser is shell-like: it unescapes backslashes and
// honours quotes. So an unquoted value carrying a JSON secret arrived with its
// escapes eaten, a value ending in a backslash glued the NEXT line onto it,
// and a value starting with a quote swallowed everything up to the next one.
// Bay's own [LoadEnvFile] read the same bytes a third way, stripping matched
// quotes and nothing else.
//
// Double-quoting and escaping `\`, `"` and the control characters is exactly
// what systemd's grammar defines, so what is written here is what systemd
// hands the process. [UnquoteEnvValue] is the other half.
func QuoteEnvValue(value string) string {
	var b strings.Builder
	b.Grow(len(value) + 2)
	b.WriteByte('"')
	for _, r := range value {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// UnquoteEnvValue reads a value written by [QuoteEnvValue].
//
// Also accepts the two older shapes, because a .env already on a VPS predates
// the quoting and must keep working: a single-quoted value (no escapes, the
// shell rule systemd follows too) and a bare unquoted one.
func UnquoteEnvValue(value string) string {
	if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		return value[1 : len(value)-1]
	}
	if len(value) < 2 || value[0] != '"' || value[len(value)-1] != '"' {
		return value
	}

	inner := value[1 : len(value)-1]
	var b strings.Builder
	b.Grow(len(inner))
	for i := 0; i < len(inner); i++ {
		if inner[i] != '\\' || i+1 >= len(inner) {
			b.WriteByte(inner[i])
			continue
		}
		i++
		switch inner[i] {
		case 'n':
			b.WriteByte('\n')
		case 'r':
			b.WriteByte('\r')
		case 't':
			b.WriteByte('\t')
		default:
			// Covers `\\` and `\"`, and leaves any other escape as the
			// character itself — the same thing systemd does with an escape
			// it does not recognise.
			b.WriteByte(inner[i])
		}
	}
	return b.String()
}
