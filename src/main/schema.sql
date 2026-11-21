-- v1 snapshot (Phases 0-1). Later changes live in db.js MIGRATIONS; never edit these tables here.
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('admin','encoder') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS offices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  archived_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  designation VARCHAR(150) NOT NULL DEFAULT '',
  employment_status ENUM('Permanent','Casual','Coterminous','Contractual','Job Order') NOT NULL,
  office_id INT NOT NULL,
  archived_at DATETIME NULL,
  UNIQUE KEY uq_employee_office (full_name, office_id),
  CONSTRAINT fk_employee_office FOREIGN KEY (office_id) REFERENCES offices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS signatories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  title VARCHAR(150) NOT NULL,
  role ENUM('recommending','approving') NOT NULL,
  archived_at DATETIME NULL,
  UNIQUE KEY uq_signatory (name, title, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS signatory_defaults (
  issuing_office ENUM('MAYOR','SB') NOT NULL,
  role ENUM('recommending','approving') NOT NULL,
  signatory_id INT NOT NULL,
  PRIMARY KEY (issuing_office, role),
  CONSTRAINT fk_default_signatory FOREIGN KEY (signatory_id) REFERENCES signatories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  form_type ENUM('PLS','TO') NOT NULL,
  issuing_office ENUM('MAYOR','SB') NOT NULL,
  period CHAR(7) NOT NULL,
  seq INT NOT NULL,
  number VARCHAR(30) NOT NULL,
  date_filed DATE NOT NULL,
  destination VARCHAR(255) NOT NULL,
  vehicle VARCHAR(150) NOT NULL DEFAULT '',
  inclusive_from DATE NOT NULL,
  inclusive_to DATE NOT NULL,
  departure_at DATETIME NOT NULL,
  return_at DATETIME NULL,
  purpose TEXT NOT NULL,
  recommending_id INT NOT NULL,
  recommending_name VARCHAR(150) NOT NULL,
  recommending_title VARCHAR(150) NOT NULL,
  approving_id INT NOT NULL,
  approving_name VARCHAR(150) NOT NULL,
  approving_title VARCHAR(150) NOT NULL,
  archived_at DATETIME NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_record_counter (form_type, issuing_office, period, seq),
  CONSTRAINT fk_record_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_record_rec FOREIGN KEY (recommending_id) REFERENCES signatories(id),
  CONSTRAINT fk_record_appr FOREIGN KEY (approving_id) REFERENCES signatories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS record_employees (
  record_id INT NOT NULL,
  position TINYINT NOT NULL,
  employee_id INT NOT NULL,
  office_id INT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  designation VARCHAR(150) NOT NULL,
  employment_status VARCHAR(20) NOT NULL,
  PRIMARY KEY (record_id, position),
  UNIQUE KEY uq_record_employee (record_id, employee_id),
  CONSTRAINT fk_re_record FOREIGN KEY (record_id) REFERENCES records(id),
  CONSTRAINT fk_re_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_re_office FOREIGN KEY (office_id) REFERENCES offices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
