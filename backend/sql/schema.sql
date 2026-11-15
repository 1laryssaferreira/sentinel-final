-- ==========================================================
-- SENTINEL — Schema do banco de dados (MySQL)
-- Execute com:  mysql -u root -p < sql/schema.sql
-- ou automaticamente via: npm run migrate
-- ==========================================================

CREATE DATABASE IF NOT EXISTS sentinel_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sentinel_db;

-- Operadores/usuários que acessam o painel
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  papel VARCHAR(40) NOT NULL DEFAULT 'Operador',
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Histórico geral de eventos do sistema (sensores, IA, chatbot, etc.)
CREATE TABLE IF NOT EXISTS eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(80) NOT NULL,
  status VARCHAR(200) NOT NULL,
  usuario_id INT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_eventos_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Moradores/residentes cadastrados no controle de acesso (Control ID)
CREATE TABLE IF NOT EXISTS residentes_autorizados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  documento_id VARCHAR(60) NULL COMMENT 'Crachá / ID de controle de acesso',
  descritor_facial JSON NULL COMMENT 'Vetor facial gerado pelo face-api.js',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Toda tentativa de acesso identificada pela IA de reconhecimento facial
CREATE TABLE IF NOT EXISTS tentativas_acesso (
  id INT AUTO_INCREMENT PRIMARY KEY,
  residente_id INT NULL,
  resultado ENUM('AUTORIZADO','NEGADO','PROCURADO') NOT NULL,
  origem VARCHAR(80) NOT NULL DEFAULT 'Reconhecimento Facial',
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tentativas_residente FOREIGN KEY (residente_id)
    REFERENCES residentes_autorizados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Leituras de geolocalização em tempo real (Geolocation API do navegador)
CREATE TABLE IF NOT EXISTS localizacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  precisao_metros DECIMAL(10,2) NULL,
  origem VARCHAR(80) NOT NULL DEFAULT 'Navegador',
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Acionamentos de emergência (protocolo automático de polícia/bombeiros)
CREATE TABLE IF NOT EXISTS acionamentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  servico ENUM('POLICIA','BOMBEIROS') NOT NULL,
  motivo VARCHAR(200) NOT NULL,
  risco_no_momento INT NOT NULL DEFAULT 0,
  automatico TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'ACIONADO',
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Última leitura de cada sensor físico da planta (persistência de estado)
CREATE TABLE IF NOT EXISTS sensores_estado (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(80) NOT NULL UNIQUE,
  estado VARCHAR(40) NOT NULL,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO sensores_estado (nome, estado) VALUES
  ('porta_principal', 'TRANCADA'),
  ('janela_sala', 'FECHADA'),
  ('sensor_fumaca', 'NORMAL'),
  ('sensor_gas', 'NORMAL');

-- Contatos vindos do site comercial (formulário "Falar com um especialista")
CREATE TABLE IF NOT EXISTS leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL,
  telefone VARCHAR(30) NULL,
  plano VARCHAR(40) NULL,
  mensagem VARCHAR(1000) NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
