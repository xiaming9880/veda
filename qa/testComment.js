var basic = require('./basic.js'),
    timeStamp = ''+Math.round(+new Date()/1000),
    assert = require('assert');

/**
 * Проверка кнопок Комментировать, Ответить, Редактировать, Удалить
 * @param driver
 * @param comment - количество кнопок Комментировать, которое должно быть;
 * @param reply - количество кнопок Ответить, которое должно быть;
 * @param edit - количество кнопок Редактировать, которое должно быть;
 * @param del - количество кнопок Удалить, которое должно быть;
*/


function check(driver, comment, reply, edit, del, phase) {
    driver.executeScript("document.querySelector('#comment-content').scrollIntoView(true);");
    driver.findElements({css:'#comment-content'}).then(function (result) {
        assert.equal(comment, result.length);
    }).thenCatch(function (e) {basic.errorHandler(e, "****** PHASE#" + phase + " > CHECK COMMENTS : ERROR = Seems number of 'comments' is wrong, expected: " + comment);});
    driver.findElements({css:'#reply'}).then(function (sum) {
        driver.findElements({css: 'a[id="reply"][style="display: none;"]'}).then(function (visible) {
            assert.equal(reply, sum.length - visible.length);
        }).thenCatch(function (e) {basic.errorHandler(e, "****** PHASE#" + phase + " > CHECK COMMENTS : ERROR = Seems number of 'reply' buttons is wrong, expected: " + reply);});
    });
    driver.findElements({css:'#edit-comment'}).then(function (sum) {
        driver.findElements({css:'a[id="edit-comment"][style="display: none;"]'}).then(function (visible) {
            assert.equal(edit, sum.length - visible.length);
        }).thenCatch(function (e) {basic.errorHandler(e, "****** PHASE#" + phase + " > CHECK COMMENTS : ERROR = Seems number of 'edit-comment' buttons is wrong, expected: " + edit);});
    });
    driver.findElements({css:'#delete'}).then(function (sum) {
        driver.findElements({css:'a[id="delete"][style="display: none;"]'}).then(function (visible) {
            assert.equal(del, sum.length - visible.length);
        }).thenCatch(function (e) {basic.errorHandler(e, "****** PHASE#" + phase + " > CHECK COMMENTS : ERROR = Seems number of 'delete' buttons is wrong, expected: " + del);});
    });
}

/**
 * Создание комментария с указаным текстом
 * @param driver 
 * @param somethingUnique - текст, который будет в комментарии
*/

function comment(driver, somethingUnique) {
    driver.executeScript("document.querySelector('em[about=\"rdfs:comment\"').scrollIntoView(true);");
    basic.execute(driver, 'sendKeys', 'div[typeof="v-s:Comment"] textarea[class="form-control"]', "****** PHASE#2 > ADD+REPLY COMMENT : ERROR = Cannot input comment", somethingUnique);
    driver.executeScript("document.querySelector('div[typeof=\"v-s:Comment\"] button[id=\"save\"]').scrollIntoView(true);");
    basic.execute(driver, 'click', 'div[typeof="v-s:Comment"] button[id="save"]', "****** PHASE#2 > ADD+REPLY COMMENT : ERROR = Cannot click  on 'save' button");
    driver.sleep(basic.SLOW_OPERATION/2);
    driver.findElement({css:'div[id="comment-content"]'}).thenCatch(function (e) {basic.errorHandler(e, "****** PHASE#2 > ADD+REPLY COMMENT : ERROR = Cannot find new comment");});
}

/**
 * 0.Open page -> Login(as kaprovrt);
 * 1.Open Administrator2 profile -> Add comment -> Reply comment;
 * 2.Check number of buttons -> Delete reply -> Check number of buttons;
 * 3.Logout -> Login(as bychinat) -> Check number of buttons;
 *
 * 0.Открываем страницу -> Заходим в систему под karpovrt;
 * 1.Заходим в профиль Администратор2 -> Добавляем комментарий1 -> Отвечаем на комментарий1;
 * 2.Проверяем количество кнопок -> Удаляем ответ -> Проверяем количество кнопок;
 * 3.Выходим из системы -> Заходим в систему под bychinat -> Проверяем количество кнопок;
*/

basic.getDrivers().forEach(function (drv) {
    //PHASE#0 : Вход
    var driver = basic.getDriver(drv);
    basic.openPage(driver, drv);
    basic.login(driver, 'karpovrt', '123', '2', 'Администратор2');

    //PHASE#1 : Комментирование
    basic.execute(driver, 'click', '#user-info', "****** PHASE#1 > ADD+REPLY COMMENT : ERROR = Cannot click on 'user-info' button");
    driver.executeScript("document.querySelector('#add-comment').scrollIntoView(true);");
    basic.execute(driver, 'click', '#add-comment', "****** PHASE#1 > ADD+REPLY COMMENT : ERROR = Cannot click on 'add-comment' button");
    comment(driver, timeStamp);
    driver.executeScript("document.querySelector('#reply').scrollIntoView(true);");
    basic.execute(driver, 'click', '#reply', "****** PHASE#1 > ADD+REPLY COMMENT : ERROR = Cannot click on 'reexply' button");
    comment(driver, timeStamp + 1);//-
    driver.sleep(basic.FAST_OPERATION);
    driver.executeScript("document.querySelector('#reply').scrollIntoView(true);");
    basic.execute(driver, 'click', '#reply', "****** PHASE#1 > ADD+REPLY COMMENT : ERROR = Cannot click on 'reply' button");
    driver.executeScript("document.querySelector('em[about=\"rdfs:comment\"').scrollIntoView(true);");
    driver.wait(basic.findUp(driver, 'div[typeof="v-s:Comment"] textarea[class="form-control"]', 1, "****** PHASE#1 > ADD+REPLY COMMENT : ERROR = Cannot click on comment field"),
        basic.FAST_OPERATION).then(function(result){basic.clickUp(result);});
    driver.executeScript("document.querySelector('div[typeof=\"v-s:Comment\"] button[id=\"save\"]').scrollIntoView(true);");
    driver.wait(basic.findUp(driver, 'div[typeof="v-s:Comment"] button[id="save"]', 1, "****** PHASE#1 > ADD+REPLY COMMENT : ERROR = Cannot click on save button"),
        basic.FAST_OPERATION).then(function(result){basic.clickUp(result);});
    driver.sleep(basic.SLOW_OPERATION/2);
    driver.findElement({css:'div[id="comment-content"]'}).thenCatch(function (e) {basic.errorHandler(e, "****** PHASE#1 > ADD+REPLY COMMENT : ERROR = Cannot find new comment");});

    //PHASE#2 : Удаление
    check(driver, 3, 3, 2, 2, 2);//-
    driver.executeScript("document.querySelector('#delete').scrollIntoView(true);");
    driver.wait(basic.findUp(driver, '#delete', 1, "****** PHASE#2 > DELETE COMMENT : ERROR = Cannot find delete buttons"), basic.FAST_OPERATION).then(function (result) {
        basic.clickUp(result);});
    driver.switchTo().alert().accept();
    driver.sleep(basic.SLOW_OPERATION/2);
    check(driver, 2, 2, 1, 1, 2);//-
    driver.wait(basic.findUp(driver, '#delete', 1, "****** PHASE#2 > DELETE COMMENT : ERROR = Cannot find delete buttons"), basic.FAST_OPERATION).then(function (result) {
        basic.clickUp(result);});
    driver.switchTo().alert().accept();
    driver.sleep(basic.SLOW_OPERATION/2);
    check(driver, 1, 1, 1, 1, 2);//-

    //PHASE#3 : Проверка из под другого пользователя
    basic.logout(driver);
    basic.login(driver, 'bychinat', '123', '4', 'Администратор4');
    driver.navigate().refresh();
    driver.sleep(basic.SLOW_OPERATION);
    driver.executeScript("document.querySelector('#reply').scrollIntoView(true);");
    check(driver, 1, 1, 0, 0, 3);
    driver.quit();
});