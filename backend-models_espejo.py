"""Modelos espejo de operación — las tablas que el receptor de sync llena.

Calcan el esquema SQL del VPS. Se añaden a los modelos de identidad
(models.py). El receptor escribe aquí lo que las cajas empujan.
"""
from sqlalchemy import Column, String, Boolean, BigInteger, Float, DateTime, text
from sqlalchemy.dialects.postgresql import UUID

from database import Base


class CajaSesion(Base):
    __tablename__ = "caja_sesiones"
    id = Column(UUID(as_uuid=False), primary_key=True)
    negocio_id = Column(UUID(as_uuid=False), nullable=False)
    dispositivo_id = Column(UUID(as_uuid=False), nullable=False)
    usuario_pos_id = Column(UUID(as_uuid=False), nullable=False)
    fondo_inicial_centavos = Column(BigInteger, nullable=False, server_default=text("0"))
    abierta_en = Column(String, nullable=False)
    cerrada_en = Column(String)
    total_efectivo_esperado_centavos = Column(BigInteger)
    total_efectivo_contado_centavos = Column(BigInteger)
    diferencia_centavos = Column(BigInteger)
    estado = Column(String, nullable=False, server_default=text("'abierta'"))
    actualizado_en = Column(String, nullable=False)
    recibido_en = Column(DateTime(timezone=True), server_default=text("now()"))


class Venta(Base):
    __tablename__ = "ventas"
    id = Column(UUID(as_uuid=False), primary_key=True)
    negocio_id = Column(UUID(as_uuid=False), nullable=False)
    dispositivo_id = Column(UUID(as_uuid=False), nullable=False)
    folio = Column(BigInteger, nullable=False)
    usuario_pos_id = Column(UUID(as_uuid=False), nullable=False)
    caja_sesion_id = Column(UUID(as_uuid=False), nullable=False)
    cliente_id = Column(UUID(as_uuid=False))
    subtotal_centavos = Column(BigInteger, nullable=False, server_default=text("0"))
    descuento_centavos = Column(BigInteger, nullable=False, server_default=text("0"))
    iva_centavos = Column(BigInteger, nullable=False, server_default=text("0"))
    total_centavos = Column(BigInteger, nullable=False, server_default=text("0"))
    estado = Column(String, nullable=False, server_default=text("'completada'"))
    creado_en = Column(String, nullable=False)
    actualizado_en = Column(String, nullable=False)
    recibido_en = Column(DateTime(timezone=True), server_default=text("now()"))


class VentaLinea(Base):
    __tablename__ = "venta_lineas"
    id = Column(UUID(as_uuid=False), primary_key=True)
    negocio_id = Column(UUID(as_uuid=False), nullable=False)
    venta_id = Column(UUID(as_uuid=False), nullable=False)
    producto_id = Column(UUID(as_uuid=False), nullable=False)
    descripcion = Column(String, nullable=False)
    cantidad = Column(Float, nullable=False)
    precio_unitario_centavos = Column(BigInteger, nullable=False)
    costo_unitario_centavos = Column(BigInteger, nullable=False, server_default=text("0"))
    descuento_linea_centavos = Column(BigInteger, nullable=False, server_default=text("0"))
    total_linea_centavos = Column(BigInteger, nullable=False)
    creado_en = Column(String, nullable=False)
    actualizado_en = Column(String, nullable=False)


class Pago(Base):
    __tablename__ = "pagos"
    id = Column(UUID(as_uuid=False), primary_key=True)
    negocio_id = Column(UUID(as_uuid=False), nullable=False)
    venta_id = Column(UUID(as_uuid=False), nullable=False)
    metodo = Column(String, nullable=False)
    monto_centavos = Column(BigInteger, nullable=False)
    recibido_centavos = Column(BigInteger)
    cambio_centavos = Column(BigInteger)
    creado_en = Column(String, nullable=False)
    actualizado_en = Column(String, nullable=False)


class MovimientoCaja(Base):
    __tablename__ = "movimientos_caja"
    id = Column(UUID(as_uuid=False), primary_key=True)
    negocio_id = Column(UUID(as_uuid=False), nullable=False)
    caja_sesion_id = Column(UUID(as_uuid=False), nullable=False)
    tipo = Column(String, nullable=False)
    motivo = Column(String)
    monto_centavos = Column(BigInteger, nullable=False)
    usuario_pos_id = Column(UUID(as_uuid=False), nullable=False)
    creado_en = Column(String, nullable=False)
    actualizado_en = Column(String, nullable=False)


class SyncLote(Base):
    __tablename__ = "sync_lotes"
    id = Column(UUID(as_uuid=False), primary_key=True)
    dispositivo_id = Column(UUID(as_uuid=False), nullable=False)
    negocio_id = Column(UUID(as_uuid=False), nullable=False)
    entidades = Column(BigInteger, nullable=False, server_default=text("0"))
    recibido_en = Column(DateTime(timezone=True), server_default=text("now()"))
