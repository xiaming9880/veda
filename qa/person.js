var webdriver = require('selenium-webdriver'),
    basic = require('./basic.js'),
    person = require('./person.js'),
    assert = require('assert');
    
module.exports = {
	/**
	 * Создать Персону с указанием уникального значения в качестве отчества
	 */
	createPerson: function (driver, drv, somethingUnique) {
		basic.openCreateDocumentForm(driver, 'Персона', 'v-s:Person');
		
		// Документ нельзя создать или отправить пока не заполнены обязательные поля
		driver.findElement({css:'div[typeof="v-s:Person"] > div.panel > div.panel-footer > button#save'}).isEnabled().then(function (flag) {
			assert(!flag);
		}).thenCatch(function (e) {basic.errorHandler(e, "Save button must be inactive")});
		
		// Удаляем preferences
		driver.executeScript("document.querySelector('[rel=\"v-ui:hasPreferences\"] button.button-delete').scrollIntoView(true);");
		driver.findElement({css:'[rel="v-ui:hasPreferences"] button.button-delete'}).click().thenCatch(function (e) {basic.errorHandler(e, "Cannot delete appointment")});
		
		// Удаляем раскрытый appointment
		driver.executeScript("document.querySelector('[rel=\"v-s:hasAppointment\"] button.button-delete').scrollIntoView(true);");
		driver.findElement({css:'[rel="v-s:hasAppointment"] button.button-delete'}).click().thenCatch(function (e) {basic.errorHandler(e, "Cannot delete appointment")});
		
		// Заполняем обязательные поля
		driver.findElement({css:'div[id="object"] [property="rdfs:label"] + veda-control input'}).sendKeys("Вася Пупкин "+somethingUnique).thenCatch(function (e) {basic.errorHandler(e, "Cannot fill rdfs:label for preson")});
		driver.findElement({css:'[property="v-s:lastName"] + veda-control input'}).sendKeys("Пупкин").thenCatch(function (e) {basic.errorHandler(e, "Cannot fill v-s:lastName for preson")});
		driver.findElement({css:'[property="v-s:firstName"] + veda-control input'}).sendKeys("Вася").thenCatch(function (e) {basic.errorHandler(e, "Cannot fill v-s:firstName for preson")});
		driver.findElement({css:'[property="v-s:middleName"] + veda-control input'}).sendKeys(somethingUnique).thenCatch(function (e) {basic.errorHandler(e, "Cannot fill v-s:middleName for preson")});
		
	    var now = new Date();
		driver.findElement({css:'[property="v-s:birthday"] + veda-control input'}).sendKeys(
				now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2))
				.thenCatch(function (e) {basic.errorHandler(e, "Cannot fill v-s:birthday for preson")});
		
		basic.chooseFromDropdown(driver, 'v-s:hasAccount', 'karpovrt', 'karpovrt');
		
		driver.executeScript("document.querySelector('[rel=\"v-s:hasAppointment\"] + veda-control input').scrollIntoView(true);");
		
		basic.chooseFromDropdown(driver, 'v-s:hasAppointment', 'Роман Карпов', 'Роман Карпов : Аналитик');

		driver.executeScript("$('div[typeof=\"v-s:Person\"] > div.panel > div.panel-footer > button#save')[0].scrollIntoView(true);");

		// Документ становится возможно сохранить
		driver.wait
		(
		  webdriver.until.elementIsEnabled(driver.findElement({css:'div[typeof="v-s:Person"] > div.panel > div.panel-footer > button#save'})),
		  basic.FAST_OPERATION
		).thenCatch(function (e) {basic.errorHandler(e, "Cannot find save button")});
		
		// Нажимаем сохранить
		driver.findElement({css:'div[typeof="v-s:Person"] > div.panel > div.panel-footer > button#save'}).click()
		      .thenCatch(function (e) {basic.errorHandler(e, "Cannot click on save button")});
		
		// Проверяем что сохранение успешно
		// Переходим на страницу просмотра документа
		driver.findElement({css:'div[id="object"] > [typeof="v-s:Person"]'}).getAttribute('resource').then(function (individualId) {
			basic.openPage(driver, drv, '#/'+individualId);	
		}).thenCatch(function (e) {basic.errorHandler(e, "Seems person is not saved")});
		
		// Смотрим что в нём содержится введённый ранее текст
		driver.findElement({css:'div[property="v-s:middleName"] span[class="value-holder"]'}).getText().then(function (txt) {
			assert(txt == somethingUnique);
		}).thenCatch(function (e) {basic.errorHandler(e, "Seems that person is not saved properly")});
	}
}