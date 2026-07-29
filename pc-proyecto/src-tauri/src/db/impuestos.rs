//! Cálculo de impuestos configurable (IVA, Sales Tax, IEPS, etc.).
//!
//! El POS apunta a varios países, así que el impuesto es genérico y
//! configurable. La configuración vive en la tabla `config`:
//!   - impuesto_activo:   "0" | "1"  (por defecto 0 = desactivado)
//!   - impuesto_nombre:   "IVA" | "Impuesto" | "Sales Tax" | ...
//!   - impuesto_modo:     "incluido" | "agregado"
//!   - impuesto_tasa:     tasa general en puntos base (1600 = 16.00%)
//!
//! Tasa en PUNTOS BASE (centésimas de %) para permitir tasas como 8.25%
//! (= 825) sin floats: 16% = 1600, 21% = 2100, 8.25% = 825.
//!
//! Dos modos:
//!   - "incluido": el precio YA contiene el impuesto (México, Europa). El total
//!     no cambia; se DESGLOSA cuánto del precio era impuesto.
//!       base = total / (1 + tasa);  impuesto = total - base
//!   - "agregado": el precio es sin impuesto y se SUMA al cobrar (EU).
//!       impuesto = subtotal * tasa;  total = subtotal + impuesto
//!
//! Cada producto puede tener su propia tasa (`iva_tasa` en puntos base); si es
//! 0 o el producto no la define, se usa la tasa general.

use serde::Serialize;

/// Configuración de impuesto resuelta (leída de config).
#[derive(Debug, Clone)]
pub struct ConfigImpuesto {
    pub activo: bool,
    pub nombre: String,
    pub modo: String,       // "incluido" | "agregado"
    pub tasa_general: i64,  // puntos base (1600 = 16%)
}

impl Default for ConfigImpuesto {
    fn default() -> Self {
        ConfigImpuesto {
            activo: false,
            nombre: "Impuesto".into(),
            modo: "incluido".into(),
            tasa_general: 0,
        }
    }
}

/// Desglose de impuesto de una venta (en centavos).
#[derive(Debug, Serialize, Default)]
pub struct DesgloseImpuesto {
    pub base_centavos: i64,      // subtotal sin impuesto
    pub impuesto_centavos: i64,  // monto del impuesto
    pub total_centavos: i64,     // lo que paga el cliente
}

/// Una línea para calcular impuesto: su importe (precio×cantidad ya con
/// descuentos) en centavos, y su tasa efectiva en puntos base.
pub struct LineaImpuesto {
    pub importe_centavos: i64,
    pub tasa_base: i64, // puntos base; si 0, se usa la general
}

/// Calcula el desglose de impuesto de una venta completa.
///
/// `importe_neto` es la suma de las líneas tras descuentos (lo que hoy es el
/// total de la venta). Según el modo:
///   - incluido: total = importe_neto (no cambia); se desglosa la base.
///   - agregado: total = importe_neto + impuesto.
pub fn calcular(
    cfg: &ConfigImpuesto,
    lineas: &[LineaImpuesto],
) -> DesgloseImpuesto {
    if !cfg.activo {
        let total: i64 = lineas.iter().map(|l| l.importe_centavos).sum();
        return DesgloseImpuesto {
            base_centavos: total,
            impuesto_centavos: 0,
            total_centavos: total,
        };
    }

    let mut impuesto_total = 0i64;
    let mut base_total = 0i64;
    let mut bruto_total = 0i64;

    for l in lineas {
        let tasa = if l.tasa_base > 0 { l.tasa_base } else { cfg.tasa_general };
        if cfg.modo == "agregado" {
            // El importe es la base; el impuesto se suma.
            let imp = redondear_impuesto(l.importe_centavos, tasa);
            base_total += l.importe_centavos;
            impuesto_total += imp;
            bruto_total += l.importe_centavos + imp;
        } else {
            // "incluido": el importe ya trae el impuesto; lo extraemos.
            // base = importe / (1 + tasa);  impuesto = importe - base
            let base = base_desde_incluido(l.importe_centavos, tasa);
            let imp = l.importe_centavos - base;
            base_total += base;
            impuesto_total += imp;
            bruto_total += l.importe_centavos;
        }
    }

    DesgloseImpuesto {
        base_centavos: base_total,
        impuesto_centavos: impuesto_total,
        total_centavos: bruto_total,
    }
}

/// impuesto = importe * tasa, con tasa en puntos base. Redondeo a centavo.
fn redondear_impuesto(importe_centavos: i64, tasa_base: i64) -> i64 {
    // importe * (tasa_base / 10000). Hacemos la multiplicación en i128 para no
    // desbordar y redondeamos al centavo más cercano.
    let prod = (importe_centavos as i128) * (tasa_base as i128);
    // dividir entre 10000 redondeando al más cercano
    ((prod + 5000) / 10000) as i64
}

/// Dado un importe con impuesto incluido y la tasa, devuelve la base (sin
/// impuesto). base = importe * 10000 / (10000 + tasa_base), redondeado.
fn base_desde_incluido(importe_centavos: i64, tasa_base: i64) -> i64 {
    let num = (importe_centavos as i128) * 10000;
    let den = 10000 + tasa_base as i128;
    ((num + den / 2) / den) as i64
}
