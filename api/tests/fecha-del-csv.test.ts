/**
 * Las fechas del CSV.
 *
 * De aquí salió un pedido que no entró y nadie supo por qué: el archivo se abrió en Excel,
 * Excel reescribió «2026-09-01» como «9/1/2026», el parser sólo entendía ISO y la fila
 * reventó al guardarse. Con la pantalla diciendo «subido exitosamente».
 *
 * Lo que más importa aquí NO es acertar la fecha: es no inventársela. Leer «9/1/2026» como
 * 9 de enero cuando era 1 de septiembre no da ningún error — archiva el pedido ocho meses
 * atrás, donde nadie lo va a buscar. Que es exactamente el síntoma que se viene a arreglar.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { convencionDeFechas, leerFecha } from '../src/lib/fechaDelCsv.ts'

const dia = (r: { fecha: Date | null }) => r.fecha?.toISOString().slice(0, 10)

test('el formato de siempre sigue igual', () => {
  assert.equal(dia(leerFecha('2026-09-01', 'iso')), '2026-09-01')
  // Mediodía: con la hora a cero, un huso al oeste lo mueve al día anterior.
  assert.equal(leerFecha('2026-09-01', 'iso').fecha?.getHours(), 12)
})

test('una fecha con un número mayor que 12 se lee sola', () => {
  // 25 no puede ser un mes: es día/mes, y da igual lo que diga la convención.
  assert.equal(dia(leerFecha('25/08/2026', 'ambigua')), '2026-08-25')
  // Y al revés: 8/25 sólo puede ser mes/día.
  assert.equal(dia(leerFecha('8/25/2026', 'ambigua')), '2026-08-25')
})

test('el archivo entero decide cómo se leen las ambiguas', () => {
  /**
   * Es la pieza que hace esto usable: basta con que UNA fila del archivo traiga un día
   * mayor que 12 para saber leer todas las demás.
   */
  assert.equal(convencionDeFechas(['25/08/2026', '1/9/2026']), 'dia-mes')
  assert.equal(convencionDeFechas(['8/25/2026', '9/1/2026']), 'mes-dia')

  assert.equal(dia(leerFecha('1/9/2026', 'dia-mes')), '2026-09-01')
  assert.equal(dia(leerFecha('9/1/2026', 'mes-dia')), '2026-09-01')
})

test('si NADA lo aclara, no se adivina: se dice', () => {
  const r = leerFecha('9/1/2026', 'ambigua')

  assert.equal(r.fecha, null)
  assert.match(r.error ?? '', /puede ser/)
  // Y se dice cómo arreglarlo, que es lo único accionable.
  assert.match(r.error ?? '', /2026-09-01/)
})

test('un archivo en ISO no es ambiguo aunque tenga fechas raras', () => {
  assert.equal(convencionDeFechas(['2026-09-01', '2026-01-09']), 'iso')
})

test('una celda vacía no es un error: es que no hay fecha comprometida', () => {
  assert.equal(leerFecha('', 'iso').fecha, null)
  assert.equal(leerFecha('', 'iso').error, undefined)
  assert.equal(leerFecha(null, 'iso').error, undefined)
})

test('lo que no es una fecha se rechaza diciendo qué se esperaba', () => {
  assert.match(leerFecha('mañana', 'iso').error ?? '', /2026-09-01/)
  assert.match(leerFecha('45/13/2026', 'dia-mes').error ?? '', /no existe/)
})
