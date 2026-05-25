// Accessible custom select (listbox) built with ARIA roles and keyboard navigation.
// 无障碍自定义下拉框: 使用 ARIA 角色和键盘导航构建.
//
// Exports: SelectOption, Select.
// Callers: theme settings, language switcher, admin forms, account settings.
//
// Pattern: uncontrolled open/active state, fully controlled value via onChange.
// 模式: 打开/活跃态为非受控, value 通过 onChange 完全受控.
//
// Keyboard contract (ARIA Listbox pattern):
//   Trigger: ArrowDown / Enter / Space → open
//   Panel:   ArrowDown/Up → move activeIndex, Home/End → jump, Enter/Space → select, Escape → close
// 键盘约定 (ARIA Listbox 模式):
//   触发器: 方向下键 / Enter / Space → 打开
//   面板: 方向键移动活跃索引, Home/End 跳转, Enter/Space 选中, Escape 关闭

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

// SelectOption is a single item in the dropdown list.
// SelectOption 是下拉列表中的单个项.
export interface SelectOption {
  value: string;
  label: string;
}

// SelectProps defines the controlled API of the Select component.
// SelectProps 定义 Select 组件的受控 API.
interface SelectProps {
  // value is the currently selected option's value key.
  // value 是当前选中项的 value 键.
  value: string;
  options: SelectOption[];
  // onChange is called with the new value whenever the user picks an option.
  // 用户选中选项时以新 value 调用 onChange.
  onChange(value: string): void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

// Select renders a custom accessible dropdown with keyboard navigation and ARIA listbox semantics.
// Select 渲染带键盘导航和 ARIA listbox 语义的自定义无障碍下拉框.
export function Select({ value, options, onChange, ariaLabel, className, disabled }: SelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // listboxID links the trigger's aria-controls to the panel element for AT readers.
  // listboxID 将触发器的 aria-controls 链接到面板元素供辅助技术读取.
  const listboxID = useId();

  const selectedIndex = useMemo(() => {
    const i = options.findIndex((o) => o.value === value);
    return i >= 0 ? i : 0;
  }, [options, value]);

  const selected = options[selectedIndex];

  const close = useCallback(() => setOpen(false), []);

  // selectedIndexRef tracks the current selected index so the effect can read it without
  // adding it to the dependency array. This prevents mid-open parent re-renders (with a new
  // value prop) from re-running the effect and resetting the user's in-progress keyboard navigation.
  // selectedIndexRef 跟踪当前选中索引, 让 effect 读取而不将其加入依赖.
  // 这样父组件在面板开启时传入新 value 重渲染, 不会触发 effect 重跑并重置用户的键盘导航位置.
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  useEffect(() => {
    if (!open) return;
    // When the panel opens, reset activeIndex to the currently selected item so the
    // keyboard cursor starts on the live selection, not wherever it was last time.
    // Capture the index at open time via ref — not from a dep — so subsequent parent
    // re-renders that change value do NOT re-trigger this effect mid-open.
    // 面板打开时将活跃索引重置为当前选中项; 通过 ref 读取索引而非声明为依赖,
    // 这样 value prop 在面板开启期间变化时不会触发 effect 重跑.
    setActiveIndex(selectedIndexRef.current);
    function onDocPointer(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  function onTriggerKey(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onPanelKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) {
        onChange(option.value);
        close();
        triggerRef.current?.focus();
      }
    }
  }

  function pickOption(option: SelectOption): void {
    onChange(option.value);
    close();
    triggerRef.current?.focus();
  }

  return (
    <div className={`select-root${className ? ` ${className}` : ""}${open ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxID}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKey}
      >
        <span className="select-trigger-label">{selected?.label ?? ""}</span>
        <span className="select-trigger-chevron" aria-hidden="true">
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1.5l5 5 5-5" />
          </svg>
        </span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="select-panel"
          role="listbox"
          id={listboxID}
          tabIndex={-1}
          aria-label={ariaLabel}
          onKeyDown={onPanelKey}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`select-option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pickOption(option)}
              >
                <span className="select-option-check" aria-hidden="true">
                  {isSelected ? "✓" : ""}
                </span>
                <span className="select-option-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
