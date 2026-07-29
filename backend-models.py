"""Modelos SQLAlchemy — mapean las tablas de yvexpos_db.

Solo se declaran aquí las tablas que el backend toca directamente en esta fase
(identidad y vinculación). Las tablas de espejo de operación (ventas, etc.) se
añadirán cuando construyamos el receptor de sync.

Los tipos calcan el esquema SQL ya aplicado en el VPS. NO usamos
Base.metadata.create_all: las tablas ya existen, creadas por el .sql. Los
modelos solo las leen/escriben.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Boolean, Integer, DateTime, ForeignKey, text
)
from sqlalchemy.dialects.postgresql import UUID

from database import Base


def _uuid():
    return str(uuid.uuid4())


class Dueno(Base):
    __tablename__ = "duenos"
    id = Column(UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    email = Column(String, unique=True, nullable=False)
    nombre = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    creado_en = Column(DateTime(timezone=True), server_default=text("now()"))
    actualizado_en = Column(DateTime(timezone=True), server_default=text("now()"))
    activo = Column(Boolean, nullable=False, server_default=text("true"))
    email_verificado = Column(Boolean, nullable=False, server_default=text("false"))


class Negocio(Base):
    __tablename__ = "negocios"
    id = Column(UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    dueno_id = Column(UUID(as_uuid=False), ForeignKey("duenos.id", ondelete="CASCADE"), nullable=False)
    nombre = Column(String, nullable=False)
    rfc = Column(String)
    codigo_postal = Column(String)
    creado_en = Column(DateTime(timezone=True), server_default=text("now()"))
    actualizado_en = Column(DateTime(timezone=True), server_default=text("now()"))


class Dispositivo(Base):
    __tablename__ = "dispositivos"
    id = Column(UUID(as_uuid=False), primary_key=True)
    negocio_id = Column(UUID(as_uuid=False), ForeignKey("negocios.id", ondelete="CASCADE"), nullable=False)
    nombre = Column(String, nullable=False)
    tipo = Column(String, nullable=False, server_default=text("'pc'"))
    prefijo_folio = Column(String)
    token_hash = Column(String)
    ultimo_visto_en = Column(DateTime(timezone=True))
    creado_en = Column(DateTime(timezone=True), server_default=text("now()"))
    actualizado_en = Column(DateTime(timezone=True), server_default=text("now()"))
    activo = Column(Boolean, nullable=False, server_default=text("true"))


class CodigoVinculacion(Base):
    """Código corto temporal (estilo YouTube/TV) para vincular un dispositivo.

    El dispositivo genera el código y espera; el dueño lo reclama desde la app.
    Al reclamarse, se crea el Dispositivo y se marca aquí el resultado para que
    el dispositivo que esperaba recoja su token.
    """
    __tablename__ = "codigos_vinculacion"
    codigo = Column(String, primary_key=True)          # "4F7K2Q9X"
    creado_en = Column(DateTime(timezone=True), server_default=text("now()"))
    expira_en = Column(DateTime(timezone=True), nullable=False)
    # Estado del reclamo:
    reclamado = Column(Boolean, nullable=False, server_default=text("false"))
    dispositivo_id = Column(UUID(as_uuid=False))        # se llena al reclamar
    token_entregado = Column(String)                    # token crudo, se entrega 1 vez
    tipo_solicitado = Column(String)                    # 'pc' | 'movil' (informativo)
