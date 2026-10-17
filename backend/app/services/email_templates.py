"""BowlByte transactional email. Text and HTML carry the same action."""

from html import escape


def branded_message(
    *,
    heading: str,
    intro: str,
    action_label: str | None = None,
    action_url: str | None = None,
    note: str,
) -> tuple[str, str]:
    """Return (plain text, HTML). The URL is shown in both versions."""

    text_lines = [heading, "", intro, ""]
    if action_label and action_url:
        text_lines.extend([f"{action_label}:", action_url, ""])
    text_lines.append(note)
    text = "\n".join(text_lines) + "\n"
    button = ""
    if action_label and action_url:
        safe_url = escape(action_url, quote=True)
        button = (
            f'<p style="margin:28px 0"><a href="{safe_url}" '
            'style="display:inline-block;background:#d5f25b;color:#14120f;'
            "font-weight:700;text-decoration:none;border-radius:999px;"
            f'padding:14px 22px">{escape(action_label)}</a></p>'
            f'<p style="font-size:13px;word-break:break-all">{safe_url}</p>'
        )
    brand = "font:700 12px Arial,sans-serif;letter-spacing:.18em;color:#d5f25b"
    title = "font-size:32px;line-height:1.05;padding-top:12px"
    copy = "font:16px/1.5 Arial,sans-serif;padding-top:16px"
    note_style = "font:14px/1.5 Arial,sans-serif;color:#c8bfae"
    html = (
        "<!doctype html><html lang='en'><body style='margin:0;background:#0f0e13;"
        "color:#f4eddd;font-family:Georgia,serif'>"
        "<table role='presentation' width='100%'><tr><td align='center' style='padding:32px 16px'>"
        "<table role='presentation' width='100%' style='max-width:520px'>"
        f"<tr><td style='{brand}'>BOWLBYTE</td></tr>"
        f"<tr><td style='{title}'>{escape(heading)}</td></tr>"
        f"<tr><td style='{copy}'>{escape(intro)}</td></tr>"
        f"<tr><td>{button}</td></tr>"
        f"<tr><td style='{note_style}'>{escape(note)}</td></tr>"
        "</table></td></tr></table></body></html>"
    )
    return text, html
