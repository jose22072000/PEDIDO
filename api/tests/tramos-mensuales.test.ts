/**
 * El troceo en meses de la recuperación.
 *
 * Ventra no pagina —sólo acepta `limit`— y `ventasDeSucursal` pide 5.000 líneas como
 * mucho. Las Tunas hace unas 4.000 en treinta días, así que un tramo largo se corta por
 * el final SIN DECIRLO: la consulta responde bien y faltan facturas. El cotejo entonces
 * marca «sin factura» pedidos que sí la tienen, y esos se quedan fuera de la ruta.
 *
 * Por eso esto se prueba: un tramo mal calculado se salta un día de facturas y nadie lo
 * ve hasta que alguien pregunta por un pedido concreto.
 */
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { tramosMensuales } from '../src/lib/tramosMensuales.ts'

// En hora LOCAL, que es como `tramosMensuales` construye los límites. Con
// `toISOString` —que es UTC— un fin de mes a las 23:59 en Cuba se lee como el día 1
// del siguiente, y la prueba fallaría por la zona horaria y no por el troceo.
const dia = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const tramos = (a: string, b: string) =>
  [...tramosMensuales(new Date(`${a}T00:00:00`), new Date(`${b}T23:59:59`))].map(
    ([i, f]) => `${dia(i)}..${dia(f)}`,
  )

describe('trocear en meses', () => {
  test('parte por meses naturales y respeta los dos extremos', () => {
    assert.deepEqual(tramos('2026-07-15', '2026-09-05'), [
      '2026-07-15..2026-07-31',
      '2026-08-01..2026-08-31',
      '2026-09-01..2026-09-05',
    ])
  })

  test('NO se salta ni repite el cambio de mes', () => {
    // El fallo clásico: usar el día 1 del mes siguiente como fin. Con eso, el 31 se
    // pide dos veces y el tramo pide un día que no le toca.
    const t = tramos('2026-07-01', '2026-08-31')

    assert.deepEqual(t, ['2026-07-01..2026-07-31', '2026-08-01..2026-08-31'])
  })

  test('un solo mes es un solo tramo', () => {
    assert.deepEqual(tramos('2026-08-03', '2026-08-20'), ['2026-08-03..2026-08-20'])
  })

  test('un solo día también', () => {
    assert.deepEqual(tramos('2026-08-03', '2026-08-03'), ['2026-08-03..2026-08-03'])
  })

  test('febrero no se descuadra al cruzar de año', () => {
    // Meses de 28 y 31 días seguidos, y un cambio de año en medio: si el avance de mes
    // se hiciera sumando 30 días, aquí se vería.
    assert.deepEqual(tramos('2025-12-20', '2026-02-10'), [
      '2025-12-20..2025-12-31',
      '2026-01-01..2026-01-31',
      '2026-02-01..2026-02-10',
    ])
  })
})
