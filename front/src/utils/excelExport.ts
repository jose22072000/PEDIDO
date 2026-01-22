/**
 * Utilidad para exportar datos a Excel usando xlsx
 */

import * as XLSX from "xlsx";

/**
 * Exporta un array de objetos a un archivo Excel
 * @param data Array de objetos con los datos a exportar
 * @param filename Nombre del archivo (sin extensión)
 * @param sheetName Nombre de la hoja (opcional, default: "Reporte")
 */
export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  filename: string,
  sheetName: string = "Reporte",
): void {
  if (data.length === 0) {
    console.warn("No hay datos para exportar");

    return;
  }

  // Crear un nuevo workbook
  const workbook = XLSX.utils.book_new();

  // Convertir los datos a una hoja de trabajo
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Calcular el ancho de las columnas basándose en el contenido
  const columns = Object.keys(data[0]);
  const colWidths = columns.map((col) => {
    const maxLength = Math.max(
      col.length,
      ...data.map((row) => String(row[col] ?? "").length),
    );

    return { wch: Math.min(maxLength + 2, 50) }; // Max 50 caracteres de ancho
  });

  worksheet["!cols"] = colWidths;

  // Agregar la hoja al workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Generar el archivo y descargarlo
  const timestamp = new Date().toISOString().split("T")[0];

  XLSX.writeFile(workbook, `${filename}_${timestamp}.xlsx`);
}

/**
 * Exporta múltiples hojas a un archivo Excel
 * @param sheets Array de objetos con { name: string, data: T[] }
 * @param filename Nombre del archivo (sin extensión)
 */
export function exportMultipleSheetsToExcel<T extends Record<string, unknown>>(
  sheets: { name: string; data: T[] }[],
  filename: string,
): void {
  if (sheets.length === 0) {
    console.warn("No hay hojas para exportar");

    return;
  }

  // Crear un nuevo workbook
  const workbook = XLSX.utils.book_new();

  sheets.forEach(({ name, data }) => {
    if (data.length === 0) return;

    // Convertir los datos a una hoja de trabajo
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Calcular el ancho de las columnas
    const columns = Object.keys(data[0]);
    const colWidths = columns.map((col) => {
      const maxLength = Math.max(
        col.length,
        ...data.map((row) => String(row[col] ?? "").length),
      );

      return { wch: Math.min(maxLength + 2, 50) };
    });

    worksheet["!cols"] = colWidths;

    // Agregar la hoja al workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, name.substring(0, 31)); // Excel limita a 31 caracteres
  });

  // Generar el archivo y descargarlo
  const timestamp = new Date().toISOString().split("T")[0];

  XLSX.writeFile(workbook, `${filename}_${timestamp}.xlsx`);
}
