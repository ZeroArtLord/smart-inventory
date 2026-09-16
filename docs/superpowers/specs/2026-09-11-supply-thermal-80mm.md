# V8.4 · Surtidos térmicos 80mm

## Objetivo
Permitir imprimir desde el historial de Surtidos cerrados una lista térmica de 80 mm con el mismo lenguaje visual y calibración ESC/POS ya usados en Comprar/Pedir, pero con una sola copia y un solo corte.

## Requisitos aprobados
- Solo aplica a documentos `SUPPLY` cerrados.
- El ticket usa `documentLine.quantity` como cantidad real surtida.
- No desglosa cantidades por lote FEFO.
- Imprime todos los renglones del surtido cerrado.
- Agrupa productos por categoría cuando la categoría está disponible.
- Mantiene columnas `PRODUCTO / CANT. / OK`, observaciones y firma.
- Título: `LISTA DE SURTIDO`.
- Una sola copia; un solo corte ESC/POS al final.
- Reutiliza la configuración actual de la RC-8002 y el mismo `EscPosWriter`.
- No modifica el flujo ni las dos copias de Compras/Pedidos.
- El servidor expone un endpoint específico protegido por `supply.write`.
- El botón `🖨 80mm` aparece en el historial de Surtidos cerrados, incluyendo documentos ajenos visibles para GOD.
- La impresión queda auditada.
- No se agregan migraciones ni se cambia stock, movimientos o documentos.

## UX
En cada fila cerrada de Surtido se agrega `🖨 80mm` junto a las acciones existentes. Al pulsarlo se construye el ticket desde el documento cerrado y sus líneas y se envía directamente a la comandera configurada. El botón muestra estado ocupado mientras imprime y luego informa resultado o error.
