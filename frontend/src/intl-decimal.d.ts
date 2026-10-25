/**
 * `Intl.NumberFormat.format` also accepts a decimal string and formats it exactly (ES2023 Intl
 * NumberFormat v3, in every current browser and Node). The bundled library types predate that.
 * A browser without it converts the string to a number first, which is still correct for display.
 */
declare namespace Intl {
  interface NumberFormat {
    format(value: string): string
  }
}
