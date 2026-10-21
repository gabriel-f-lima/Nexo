import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

/** Menu de seleção no estilo do Nexo. Funciona com mouse, toque e teclado (setas, Enter e Esc). */
export default function SelectField({
  value,
  onChange,
  options,
  label,
  placeholder = 'Selecione',
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[active];
      if (option) choose(option.value);
    }
  };

  return (
    <div className="sf" ref={rootRef} style={width ? { width, flex: 'none' } : undefined}>
      <button
        type="button"
        className="input sf-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={current ? '' : 'dp-placeholder'}>{current?.label ?? placeholder}</span>
        <ChevronDown size={18} className={`sf-chev${open ? ' up' : ''}`} />
      </button>

      {open ? (
        <motion.ul
          className="sf-menu"
          role="listbox"
          aria-label={label}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <li
                key={option.value || '__none'}
                role="option"
                aria-selected={selected}
                className={`sf-option${index === active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => { e.preventDefault(); choose(option.value); }}
              >
                <span>{option.label}</span>
                {selected ? <Check size={16} /> : null}
              </li>
            );
          })}
        </motion.ul>
      ) : null}
    </div>
  );
}
