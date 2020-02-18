// Veda application authentication

veda.Module(function (veda) { "use strict";

  var storage = typeof localStorage !== "undefined" ? localStorage : {
    clear: function () {
      var self = this;
      Object.keys(this).map(function (key) {
        if (typeof self[key] !== "function") delete self[key];
      });
    }
  };

  // Login invitation
  var loginForm = $(".login-form");

  $("#submit-login-password", loginForm).click( function (e) {
    e.preventDefault();
    var login = $("#login", loginForm).val(),
      password = $("#password", loginForm).val(),
      hash = Sha256.hash(password);

    // Try internal authentication
    veda.login(login, hash)
      // Try ntlm authentication
      .catch(function (error) {
        console.log(error);
        if (error.code === 429) { throw error; }
        var ntlmProvider = new veda.IndividualModel("cfg:NTLMAuthProvider", true, false);
        return ntlmProvider.load().then(function (ntlmProvider) {
          var ntlm = !ntlmProvider.hasValue("v-s:deleted", true) && ntlmProvider.hasValue("rdf:value") && ntlmProvider.get("rdf:value")[0];
          if (ntlm) {
            var params = {
              type: "POST",
              url: "/ad/",
              data: {
                "login": login,
                "password": password
              },
              dataType: "json",
              async: true
            };
            return $.ajax(params);
          } else {
            throw error;
          }
        });
      })
      .then(handleLoginSuccess)
      .catch(handleLoginError);
  });

  $("#new-password, #confirm-new-password, #secret", loginForm).on("input", validateNewPassword);
  var re = new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.{6,})");
  function validateNewPassword() {
    var submit = $("#submit-new-password", loginForm);
    var newPasswordGroup = $("#new-password-group", loginForm);
    var newPassword = $("#new-password", loginForm);
    var confirmNewPassword = $("#confirm-new-password", loginForm);
    var passwordStrength = $(".password-strength", loginForm);
    var passwordMustMatch = $(".password-must-match", loginForm);
    var secretGroup = $("#secret-group", loginForm);
    var secret = $("#secret", loginForm);
    var enterSecret = $(".enter-secret", loginForm);

    var reMatch = re.test( newPassword.val() );
    var passwordsMatch = confirmNewPassword.val() === newPassword.val();
    var isSecret = !!secret.val();
    var isValid = reMatch && passwordsMatch && isSecret;

    if ( !reMatch ) {
      passwordStrength.show();
    } else {
      passwordStrength.hide();
    }
    if ( !passwordsMatch ) {
      passwordMustMatch.show();
    } else {
      passwordMustMatch.hide();
    }
    if ( !isSecret ) {
      enterSecret.show();
    } else {
      enterSecret.hide();
    }
    if ( !isValid ) {
      submit.attr("disabled", "disabled");
    } else {
      submit.removeAttr("disabled", "disabled");
    }
  }

  $("#submit-new-password", loginForm).click( function (e) {
    e.preventDefault();
    var login = $("#login", loginForm).val(),
      password = $("#new-password", loginForm).val(),
      secret = $("#secret", loginForm).val(),
      hash = Sha256.hash(password);

    veda.login(login, hash, secret)
      .then(handleLoginSuccess)
      .catch(handleLoginError);
  });

  var forgotPasswordPressed;
  $("#forgot-password, #request-secret", loginForm).click( function (e) {
    e.preventDefault();
    forgotPasswordPressed = true;
    var login = $("#login", loginForm).val(),
      secret = "?";

    veda.login(login, undefined, secret)
      .then(handleLoginSuccess)
      .catch(handleLoginError);
  });

  var captchaRendered = false;
  function reCAPTCHA(onSuccess, onExpired, onError) {
    if (!captchaRendered) {
      var reCAPTCHA_key = new veda.IndividualModel("cfg:reCAPTCHA_client_key");
      reCAPTCHA_key.load().then(function (reCAPTCHA_key) {
        window.captchaCallback = function() {
          grecaptcha.render("recaptcha", {
            "sitekey": reCAPTCHA_key.get("rdf:value")[0].toString(),
            "theme": "light",
            "callback": onSuccess,
            "expired-callback": onExpired,
            "error-callback": onError,
          });
          captchaRendered = true;
        };
        var captchaScript = document.createElement("script");
        captchaScript.src = "https://www.google.com/recaptcha/api.js?onload=captchaCallback&render=explicit";
        document.head.appendChild(captchaScript);
      });
    } else {
      grecaptcha.reset();
    }
  }

  function handleLoginError(error) {
    var enterLoginPassword = $("#enter-login-password", loginForm).hide();
    var enterNewPassword = $("#enter-new-password", loginForm).hide();
    var loginFailedError = $("#login-failed-error", loginForm).hide();
    var passwordExpiredError = $("#password-expired-error", loginForm).hide();
    var invalidSecretWarning = $("#invalid-secret-warning", loginForm).hide();
    var emptyPasswordWarning = $("#empty-password-warning", loginForm).hide();
    var equalPasswordWarning = $("#equal-password-warning", loginForm).hide();
    var invalidPasswordWarning = $("#invalid-password-warning", loginForm).hide();
    var frequentPassChangeWarning = $("#frequent-pass-change-warning", loginForm).hide();
    var passChangeNotAllowedWarning = $("#pass-change-not-allowed-warning", loginForm).hide();
    var secretExpiredWarning = $("#secret-expired-warning", loginForm).hide();
    var authLockedError = $("#auth-locked-error", loginForm).hide();
    var passChangeLockedError = $("#pass-change-locked-error", loginForm).hide();
    var secretRequestInfo = $("#secret-request-info", loginForm).hide();
    switch (error.code) {
      case 423: // Password change is allowed once a day
        frequentPassChangeWarning.show();
        setTimeout(function () {
          frequentPassChangeWarning.hide();
          enterLoginPassword.show();
        }, 10 * 1000);
        break;
      case 429: // Too many auth fails
        authLockedError.show();
        setTimeout(function () {
          authLockedError.hide();
          enterLoginPassword.show();
        }, 30 * 60 * 1000);
        break;
      case 430: // Too many pass change fails
        passChangeLockedError.show();
        setTimeout(function () {
          passChangeLockedError.hide();
          enterLoginPassword.show();
        }, 30 * 60 * 1000);
        break;
      case 463: // Password change not allowed
        passChangeNotAllowedWarning.show();
        setTimeout(function () {
          passChangeNotAllowedWarning.hide();
          enterLoginPassword.show();
        }, 10 * 1000);
        break;
      case 464: // Secret expired
        secretExpiredWarning.show();
        setTimeout(function () {
          secretExpiredWarning.hide();
          enterNewPassword.show();
        }, 10 * 1000);
        break;
      case 465: // Empty password
        emptyPasswordWarning.show();
        setTimeout(function () {
          emptyPasswordWarning.hide();
          enterNewPassword.show();
        }, 10 * 1000);
        break;
      case 466: // New password is equal to old
        equalPasswordWarning.show();
        setTimeout(function () {
          equalPasswordWarning.hide();
          enterNewPassword.show();
        }, 10 * 1000);
        break;
      case 467: // Invalid password
        invalidPasswordWarning.show();
        setTimeout(function () {
          invalidPasswordWarning.hide();
          enterNewPassword.show();
        }, 10 * 1000);
        break;
      case 468: // Invalid secret
        invalidSecretWarning.show();
        setTimeout(function () {
          invalidSecretWarning.hide();
          enterNewPassword.show();
        }, 10 * 1000);
        break;
      case 469: // Password expired
        enterNewPassword.show();
        if ( !forgotPasswordPressed ) {
          passwordExpiredError.show();
        }
        secretRequestInfo.show();
        break;
      case 473: // Authentication failed
      default:
        loginFailedError.show();
        reCAPTCHA(onSuccess, onExpired, onSuccess);
        break;
    }
    function onSuccess() {
      $(".alert, fieldset", loginForm).hide();
      enterLoginPassword.show();
    }
    function onExpired() {
      $(".alert, fieldset", loginForm).hide();
      loginFailedError.show();
    }
  }

  function handleLoginSuccess(authResult) {
    var enterLoginPassword = $("#enter-login-password", loginForm).show();
    var enterNewPassword = $("#enter-new-password", loginForm).hide();
    var loginFailedError = $("#login-failed-error", loginForm).hide();
    var passwordExpiredError = $("#password-expired-error", loginForm).hide();
    var invalidSecretWarning = $("#invalid-secret-warning", loginForm).hide();
    var emptyPasswordWarning = $("#empty-password-warning", loginForm).hide();
    var equalPasswordWarning = $("#equal-password-warning", loginForm).hide();
    var invalidPasswordWarning = $("#invalid-password-warning", loginForm).hide();
    var frequentPassChangeWarning = $("#frequent-pass-change-warning", loginForm).hide();
    var authLockedError = $("#auth-locked-error", loginForm).hide();
    var passChangeLockedError = $("#pass-change-locked-error", loginForm).hide();
    var secretRequestInfo = $("#secret-request-info", loginForm).hide();
    veda.trigger("login:success", authResult);
  }

  function setTicketCookie(ticket, expires) {
    document.cookie = "ticket=" + ticket + "; expires=" + new Date(parseInt(expires)).toGMTString() + "; samesite=strict;";
  }
  function delTicketCookie() {
    setTicketCookie(null, 0);
  }

  veda.on("login:failed", function () {
    $("#app").empty();
    delete storage.ticket;
    delete storage.user_uri;
    delete storage.end_time;
    delTicketCookie();

    if (storage.logout) {
      loginForm.show();
      delete storage.logout;
      return;
    }

    // NTLM auth using iframe
    var ntlmProvider = new veda.IndividualModel("cfg:NTLMAuthProvider", true, false);
    ntlmProvider.load().then(function (ntlmProvider) {
      var ntlm = !ntlmProvider.hasValue("v-s:deleted", true) && ntlmProvider.hasValue("rdf:value") && ntlmProvider.get("rdf:value")[0];
      if (ntlm) {
        var iframe = $("<iframe>", {"class": "hidden"});
        iframe.appendTo(loginForm);
        iframe.one("load", function () {
          try {
            loginForm.hide();
            var body = iframe.contents().find("body"),
              ticket = $("#ticket", body).text(),
              user_uri = $("#user_uri", body).text(),
              end_time = $("#end_time", body).text(),
              authResult = {
                ticket: ticket,
                user_uri: user_uri,
                end_time: end_time
              };
            if (ticket && user_uri && end_time) {
              veda.trigger("login:success", authResult);
            } else {
              throw "auto ntlm auth failed";
            }
          } catch (err) {
            console.log(err);
            loginForm.show();
          }
        });
        document.domain = document.domain;
        iframe.attr("src", ntlm);
      } else {
        loginForm.show();
      }
    });
  });

  // Initialize application if ticket is valid
  veda.on("login:success", function (authResult) {
    loginForm.hide();
    veda.user_uri = storage.user_uri = authResult.user_uri;
    veda.ticket = storage.ticket = authResult.ticket;
    veda.end_time = storage.end_time = authResult.end_time;
    setTicketCookie(veda.ticket, veda.end_time);
    // Re-login on ticket expiration
    if( veda.end_time ) {
      var ticketDelay = parseInt(veda.end_time) - Date.now();
      var ticketDelayHours = Math.floor(ticketDelay / 1000 / 60 / 60);
      var ticketDelayMinutes = Math.floor(ticketDelay / 1000 / 60 - ticketDelayHours  * 60);
      console.log("Ticket will expire in %d hrs. %d mins.", ticketDelayHours, ticketDelayMinutes);
      setTimeout(function () {
        console.log("Ticket expired, re-login.");
        veda.trigger("login:failed");
      }, ticketDelay);
    }
    veda.start();
  });

  // Logout handler
  veda.on("logout", function () {
    delete storage.ticket;
    delete storage.user_uri;
    delete storage.end_time;
    delTicketCookie();
    storage.logout = true;
    location.reload();
  });

  // Init application
  veda.init()
    .then(function () {
      // Check if ticket is valid
      var ticket = storage.ticket,
          user_uri = storage.user_uri,
          end_time = ( new Date() < new Date(parseInt(storage.end_time)) ) && storage.end_time;
      if (ticket && user_uri && end_time) {
        return veda.Backend.is_ticket_valid(ticket);
      } else {
        return false;
      }
    })
    .then(function (valid) {
      if (valid) {
        veda.trigger("login:success", {
          ticket: storage.ticket,
          user_uri: storage.user_uri,
          end_time: storage.end_time
        });
      } else {
        var authRequired = new veda.IndividualModel("cfg:AuthRequired");
        authRequired.load().then(function (authRequiredParam) {
          if ( authRequiredParam && authRequiredParam.hasValue("rdf:value", false) ) {
            veda.trigger("login:success", {
              ticket: "",
              user_uri: "cfg:Guest",
              end_time: 0
            });
          } else {
            veda.trigger("login:failed");
          }
        });
      }
    });
});
