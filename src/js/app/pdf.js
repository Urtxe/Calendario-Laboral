async function generarInformePDF() {
    if (typeof trackExportacionPDF === 'function') trackExportacionPDF('intento');
    if (!usuarioPuedeUsarPremium()) {
        if (typeof abrirModalPremium === 'function') abrirModalPremium();
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const colorApp = [36, 52, 77];

    const selectorJ = document.getElementById('tipoJornada');
    const inputC = document.getElementById('inputJornadaCustom');
    const j = (selectorJ.value === 'custom') ? (parseFloat(inputC.value) || 1) : (parseFloat(selectorJ.value) || 1);

    const idUsuario = usuarioActual.displayName || usuarioActual.email;
    const nombreMes = (typeof nombresMeses !== 'undefined') ? nombresMeses[mesActual] : "Mes";

    doc.setFillColor(colorApp[0], colorApp[1], colorApp[2]);
    doc.rect(0, 0, 210, 40, 'F');

    try {
        const logoImg = "assets/images/logo.png";
        doc.addImage(logoImg, 'PNG', 170, 8, 24, 24);
    } catch (e) {
        console.warn("No se pudo cargar el logo:", e);
    }

    doc.setFontSize(18); doc.setTextColor(255);
    doc.text(`BALANCE LABORAL - REGISTRO DE JORNADA`, 20, 15);

    doc.setFontSize(10);
    doc.text(`TRABAJADOR: ${idUsuario.toUpperCase()}`, 20, 25);
    doc.text(`PERIODO: ${nombreMes.toUpperCase()} ${anioActual}`, 20, 32);

    const filas = [];
    let totalHorasMes = 0;
    let totalExtrasMes = 0;
    let totalExtrasAnio = 0;
    let festivosTrabajadosMes = 0;
    const diasMes = new Date(anioActual, mesActual + 1, 0).getDate();

    for (const clave in horasExtraPorDia) {
        if (clave.startsWith(String(anioActual))) {
            totalExtrasAnio += horasExtraPorDia[clave];
        }
    }

    for (let d = 1; d <= diasMes; d++) {
        const f = new Date(anioActual, mesActual, d);
        const k = getFechaKey(f);
        const r = diasMarcados[k];
        const e = (horasExtraPorDia && horasExtraPorDia[k]) ? horasExtraPorDia[k] : 0;

        totalExtrasMes += e;
        if (r && (r.tipo === 'trabajado' || r.tipo === 'baja')) {
            totalHorasMes += (8 * j);
            if (esFestivo(f)) festivosTrabajadosMes++;
        }
        filas.push([`${d}/${mesActual + 1}`, r ? r.tipo.toUpperCase() : "NO REGISTRADO", e > 0 ? e + "h" : "-"]);
    }

    doc.autoTable({
        startY: 45,
        head: [['FECHA', 'ESTADO DE JORNADA', 'HORAS EXTRA']],
        body: filas,
        headStyles: { fillColor: colorApp },
        theme: 'striped',
        styles: { fontSize: 9 },
        didDrawPage: function (data) {
            let finalY = data.cursor.y + 10;
            doc.setFontSize(10);
            doc.setFont(undefined, 'bold');

            if (totalExtrasAnio > 80) {
                doc.setTextColor(200, 0, 0);
                doc.text(`TOTAL HORAS EXTRA ANUAL: ${totalExtrasAnio}h (EXCEDE LÍMITE LEGAL 80h)`, 14, finalY);
            } else {
                doc.setTextColor(0, 0, 0);
                doc.text(`TOTAL HORAS EXTRA ANUAL: ${totalExtrasAnio}h / 80h`, 14, finalY);
            }
        }
    });

    doc.addPage();
    doc.setFillColor(colorApp[0], colorApp[1], colorApp[2]);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255);
    doc.setFontSize(16);
    doc.text("RESUMEN MENSUAL Y VALIDACIÓN", 20, 20);

    doc.setTextColor(40); doc.setFontSize(12);
    let yPos = 50;
    doc.setFont(undefined, 'bold');
    doc.text("Estadísticas del Periodo:", 20, yPos);
    doc.setFont(undefined, 'normal');
    yPos += 12;
    doc.text(`• Total Horas Ordinarias: ${Math.round(totalHorasMes)}h`, 25, yPos);
    yPos += 8;
    doc.text(`• Total Horas Extraordinarias del mes: ${totalExtrasMes}h`, 25, yPos);
    yPos += 8;
    doc.text(`• Días Festivos Trabajados: ${festivosTrabajadosMes}`, 25, yPos);
    yPos += 8;
    doc.text(`• Total Horas Extraordinarias del año: ${totalExtrasAnio}h`, 25, yPos);

    yPos += 30;
    doc.setDrawColor(200);
    doc.rect(15, yPos, 180, 45);
    doc.setFontSize(10); doc.setFont(undefined, 'bold');
    doc.text("CERTIFICACIÓN DIGITAL DE AUTENTICIDAD", 20, yPos + 10);
    doc.setFont(undefined, 'normal'); doc.setFontSize(8);
    const hashS = btoa(usuarioActual.uid + anioActual + mesActual).substring(0, 24).toUpperCase();
    doc.text(`ID de Verificación Cloud: RLC-${hashS}-${anioActual}`, 20, yPos + 20);
    doc.text(`Fecha de Certificación: ${new Date().toLocaleString()}`, 20, yPos + 25);

    yPos += 80;
    doc.setFontSize(10);
    doc.text("Firma del Trabajador:", 20, yPos);
    doc.text("Sello y Firma de la Empresa:", 120, yPos);
    doc.line(20, yPos + 20, 80, yPos + 20);
    doc.line(120, yPos + 20, 180, yPos + 20);

    doc.save(`Registro_Oficial_${nombreMes}_${idUsuario.split('@')[0]}.pdf`);

    if (typeof trackExportacionPDF === 'function') trackExportacionPDF('exito');
}
