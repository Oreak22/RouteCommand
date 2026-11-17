# Theme tokens

RouteCommand uses DaisyUI custom themes and Tailwind CSS 4. The source of truth is `src/index.css`; the visual reference is the development-only `/__styleguide` page.

## Semantic palette

| Token       | Dark use                          | Light use                           |
| ----------- | --------------------------------- | ----------------------------------- |
| `primary`   | calm teal for actions and focus   | deep teal for actions and focus     |
| `secondary` | muted blue for supporting actions | slate blue for supporting actions   |
| `accent`    | warm brass for small highlights   | deep ochre for small highlights     |
| `neutral`   | slate panel and neutral action    | soft slate panel and neutral action |
| `base-100`  | raised ink-blue surfaces          | white surfaces                      |
| `base-200`  | deep blue-gray page background    | cool near-white page background     |
| `base-300`  | inset surface and dividers        | cool gray inset surface             |
| `info`      | informational state               | informational state                 |
| `success`   | positive state                    | positive state                      |
| `warning`   | caution state                     | caution state                       |
| `error`     | failure or destructive action     | failure or destructive action       |

## Domain colors

Use `getStatusColor(category, status)` from `domain-colors.ts` for a pill surface and label. The CSS names below are utilities generated from the domain variables; their values change with the active theme.

| Domain          | Tokens                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Driver status   | `OFFLINE`, `AVAILABLE`, `BUSY`, `ON_BREAK`                                                                                       |
| Shipment status | `CREATED`, `ASSIGNED`, `ACCEPTED`, `PICKED_UP`, `IN_TRANSIT`, `ARRIVED`, `DELIVERED`, `CANCELLED`, `FAILED_DELIVERY`, `RETURNED` |
| Alert severity  | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`                                                                                              |
| Zone type       | `DELIVERY`, `RESTRICTED`, `DEPOT`, `CUSTOM`                                                                                      |

`getStatusColor(category, status)` maps every domain enum to its semantic palette. Related shipment states share a visual family while retaining their individual labels.

## Typography and shape

- UI family: locally bundled Inter Variable (`font-sans`).
- Coordinate, tracking ID, and timestamp family: locally bundled IBM Plex Mono (`font-data`).
- Use the Tailwind text scale from `text-xs` through `text-3xl`; use standard Tailwind tracking and spacing utilities.
- DaisyUI `rounded-field`, `rounded-btn`, and `rounded-box` define standard control, button, and surface radii. Surfaces use a restrained 14px radius; fields use 10px.
- Focus uses a visible primary-color outline. Reduced-motion users receive near-instant transitions and no smooth scrolling.
- Motion stays functional: controls use short state transitions, with no decorative entrance effects. The system honors `prefers-reduced-motion`.

## Theme selection

`ThemeProvider` stores `system`, `light`, or `dark` under `routecommand-theme`. First visit follows `prefers-color-scheme`. Explicit selection is applied before the application mounts and persisted across reloads.
