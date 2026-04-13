// Инициализация кастомного select
export function initCustomSelect(selectId) {
  const customSelect = document.getElementById(selectId);
  if (!customSelect || customSelect.dataset.initialized) return;

  customSelect.dataset.initialized = "true";

  const selectSelected = customSelect.querySelector(".select-selected");
  const selectItems = customSelect.querySelector(".select-items");
  const hiddenInput = customSelect.querySelector('input[type="hidden"]');

  // Открытие/закрытие списка
  selectSelected.addEventListener("click", function () {
    selectItems.classList.toggle("select-hide");
    // Закрыть другие открытые select
    document.querySelectorAll(".select-items").forEach((item) => {
      if (item !== selectItems) {
        item.classList.add("select-hide");
      }
    });
  });

  // Выбор опции
  selectItems.querySelectorAll("div").forEach((item) => {
    item.addEventListener("click", function () {
      const value = this.getAttribute("data-value");
      const text = this.innerHTML;

      hiddenInput.value = value;
      selectSelected.innerHTML = text;
      selectItems.classList.add("select-hide");

      // Вызвать обработчик изменения, если есть
      if (selectId === "eventIconSelect") {
        // Для create, ничего, так как custom через чекбокс
      } else if (selectId === "editEventIconSelect") {
        // Аналогично
      }
    });
  });
}

// Глобальный listener для закрытия select при клике вне
document.addEventListener("click", function (e) {
  if (!e.target.closest(".custom-select")) {
    document.querySelectorAll(".select-items").forEach((item) => {
      item.classList.add("select-hide");
    });
  }
});

// Установка значения для кастомного select
export function setCustomSelectValue(selectId, value) {
  const customSelect = document.getElementById(selectId);
  if (!customSelect) return;

  const selectSelected = customSelect.querySelector(".select-selected");
  const hiddenInput = customSelect.querySelector('input[type="hidden"]');
  const item = customSelect.querySelector(`div[data-value="${value}"]`);

  if (item) {
    hiddenInput.value = value;
    selectSelected.innerHTML = item.innerHTML;
  }
}
