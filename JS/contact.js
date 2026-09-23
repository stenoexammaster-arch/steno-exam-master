// js/contact.js
// Contact page logic: validation + save to Firestore "feedback" collection

(function () {
  'use strict';

  var SUPPORT_EMAIL = 'stenoexammaster@gmail.com';

  var SUBJECT_MAP = {
    'typing-test-issue': 'Typing Test Issue - Support Request',
    'steno-exam-doubt': 'Steno Exam Doubt - Support Request',
    'hindi-typing-problem': 'Hindi Typing Problem - Support Request',
    'result-certificate-query': 'Result / Certificate Query',
    'book-course-suggestion': 'Book / Course Suggestion',
    'feedback-suggestion': 'Feedback / Suggestion',
    'other': 'General Query - Steno / Typing Support'
  };

  function $(id) {
    return document.getElementById(id);
  }

  function isValidEmail(email) {
    if (!email) return false;
    var pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(email);
  }

  function clearErrors() {
    var errorSummary = $('formErrorSummary');
    if (errorSummary) {
      errorSummary.textContent = '';
      errorSummary.classList.remove('is-visible');
    }

    var fieldIds = ['fullName', 'email', 'purpose', 'message'];
    fieldIds.forEach(function (id) {
      var input = $(id);
      var errorEl = $(id + 'Error');
      if (input) {
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
      }
      if (errorEl) {
        errorEl.textContent = '';
      }
    });
  }

  function validateForm() {
    var errors = {};

    var fullName = ($('fullName').value || '').trim();
    var email = ($('email').value || '').trim();
    var purpose = ($('purpose').value || '').trim();
    var message = ($('message').value || '').trim();

    if (!fullName) {
      errors.fullName = 'Please enter your full name.';
    } else if (fullName.length < 2) {
      errors.fullName = 'Full name should be at least 2 characters long.';
    }

    if (!email) {
      errors.email = 'Please enter your email address.';
    } else if (!isValidEmail(email)) {
      errors.email = 'Please enter a valid email address (for example: name@example.com).';
    }

    if (!purpose) {
      errors.purpose = 'Please select a purpose for your message.';
    }

    if (!message) {
      errors.message = 'Please describe your issue or question.';
    } else if (message.length < 10) {
      errors.message = 'Please provide a little more detail (minimum 10 characters).';
    }

    return errors;
  }

  function displayErrors(errors) {
    var errorSummary = $('formErrorSummary');
    var firstInvalid = null;
    var order = ['fullName', 'email', 'purpose', 'message'];

    order.forEach(function (fieldId) {
      var msg = errors[fieldId];
      var input = $(fieldId);
      var errorEl = $(fieldId + 'Error');
      if (!input || !errorEl) return;

      if (msg) {
        errorEl.textContent = msg;
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');
        if (!firstInvalid) firstInvalid = input;
      } else {
        errorEl.textContent = '';
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
      }
    });

    if (errorSummary) {
      if (Object.keys(errors).length > 0) {
        errorSummary.textContent = 'Please correct the highlighted fields and try again.';
        errorSummary.classList.add('is-visible');
      } else {
        errorSummary.textContent = '';
        errorSummary.classList.remove('is-visible');
      }
    }

    if (firstInvalid && typeof firstInvalid.focus === 'function') {
      firstInvalid.focus();
    }
  }

  function showStatus(message, type) {
    var statusEl = $('formStatus');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = 'form-status'; // reset
    if (message && type) {
      statusEl.classList.add(type);
    }
  }

  // Save contact form to Firestore "feedback" collection
  function saveToFirestore(values) {
    return new Promise(function (resolve, reject) {
      if (!(window.db && window.firebase && firebase.firestore)) {
        reject(new Error('Firestore is not available on this page.'));
        return;
      }

      var payload = {
        name: values.fullName || null,
        email: values.email,
        purpose: values.purposeText || values.purpose || null,
        message: values.message,
        hasAttachment: !!values.attachmentName,
        attachmentName: values.attachmentName || null,
        subject: values.subject || null,
        page: window.location.pathname,
        source: 'contact-form',
        createdAt: Date.now()
      };

      try {
        var ts =
          firebase.firestore.FieldValue &&
          firebase.firestore.FieldValue.serverTimestamp();
        if (ts) payload.createdAt = ts;

        window.db
          .collection('feedback')
          .add(payload)
          .then(function (docRef) {
            console.log('Contact form saved to feedback with ID:', docRef.id);
            resolve();
          })
          .catch(function (err) {
            console.error('Firestore write error (contact form):', err);
            reject(err);
          });
      } catch (e) {
        console.error('Firestore access error:', e);
        reject(e);
      }
    });
  }

  function init() {
    var form = $('contactForm');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      showStatus('', null);
      clearErrors();

      var errors = validateForm();
      if (Object.keys(errors).length > 0) {
        displayErrors(errors);
        return;
      }

      var purposeSelect = $('purpose');
      var purposeValue = (purposeSelect.value || '').trim();
      var purposeText = purposeSelect.options[purposeSelect.selectedIndex]
        ? purposeSelect.options[purposeSelect.selectedIndex].text
        : 'General Query';

      var subject = SUBJECT_MAP[purposeValue] || 'Query - Steno / Typing Support';

      var attachmentInput = $('attachment');
      var attachmentName = '';
      if (attachmentInput && attachmentInput.files && attachmentInput.files.length > 0) {
        attachmentName = attachmentInput.files[0].name;
      }

      var values = {
        fullName: ($('fullName').value || '').trim(),
        email: ($('email').value || '').trim(),
        purpose: purposeValue,
        purposeText: purposeText,
        subject: subject,
        message: ($('message').value || '').trim(),
        attachmentName: attachmentName
      };

      showStatus('Submitting your message, please wait…', 'info');

      saveToFirestore(values)
        .then(function () {
          showStatus(
            'Your message has been submitted successfully. We will review it and reply to you on your email address.',
            'success'
          );
          form.reset();
        })
        .catch(function (err) {
          console.error(err);
          showStatus(
            'We could not submit your message right now. Please refresh the page or email us directly at ' +
              SUPPORT_EMAIL +
              '.',
            'error'
          );
        });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();