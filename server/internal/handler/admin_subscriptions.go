package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
	"github.com/mritd/kmtv/internal/utils"
)

// ListSubscriptions returns all subscriptions.
// ListSubscriptions 返回所有订阅.
func (h *Handler) ListSubscriptions(c *gin.Context) {
	subs, err := h.store.ListSubscriptions()
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to list subscriptions"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"subscriptions": subs})
}

// CreateSubscription creates a new subscription.
// CreateSubscription 创建一个新订阅.
func (h *Handler) CreateSubscription(c *gin.Context) {
	var sub model.Subscription
	if err := c.ShouldBindJSON(&sub); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	if sub.URL == "" {
		c.JSON(http.StatusBadRequest, errs.MissingFields.WithMsg("url is required"))
		return
	}

	if err := utils.ValidateExternalURL(sub.URL); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidURL.WithMsg("invalid subscription URL: "+err.Error()))
		return
	}

	id, err := h.store.CreateSubscription(sub.URL, sub.AutoUpdate, sub.Interval)
	if err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to create subscription"))
		return
	}

	sub.ID = id
	h.sourceSvc.UpdateSubCron(id, sub.AutoUpdate, sub.Interval)

	// Best-effort: sync sources right after import so they appear without waiting for the
	// next cron tick or a manual sync. A failure here (slow or unreachable URL) is logged but
	// does not fail creation — the record exists and the user can retry via the manual sync button.
	// 尽力而为: 导入后立即同步源, 让源无需等待下次 cron 或手动同步即可出现.
	// 此处失败 (URL 慢或不可达) 仅记录日志, 不让创建失败 — 记录已存在, 用户可点手动同步重试.
	if err := h.sourceSvc.SyncSubscription(id); err != nil {
		logrus.WithError(err).WithField("subscription_id", id).Warn("auto-sync after subscription create failed")
	}

	c.JSON(http.StatusCreated, sub)
}

// UpdateSubscription updates an existing subscription.
// UpdateSubscription 更新已有订阅.
func (h *Handler) UpdateSubscription(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidID.WithMsg("invalid subscription id"))
		return
	}

	var sub model.Subscription
	if err := c.ShouldBindJSON(&sub); err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidRequest)
		return
	}

	if sub.URL != "" {
		if err := utils.ValidateExternalURL(sub.URL); err != nil {
			c.JSON(http.StatusBadRequest, errs.InvalidURL.WithMsg("invalid subscription URL: "+err.Error()))
			return
		}
	}

	if err := h.store.UpdateSubscription(id, sub.URL, sub.AutoUpdate, sub.Interval); err != nil {
		if errors.Is(err, errs.ErrNotFound) {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("subscription not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to update subscription"))
		return
	}

	h.sourceSvc.UpdateSubCron(id, sub.AutoUpdate, sub.Interval)
	c.JSON(http.StatusOK, gin.H{"message": "subscription updated"})
}

// DeleteSubscription deletes a subscription.
// DeleteSubscription 删除一个订阅.
func (h *Handler) DeleteSubscription(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidID.WithMsg("invalid subscription id"))
		return
	}

	if err := h.store.DeleteSubscription(id); err != nil {
		if errors.Is(err, errs.ErrNotFound) {
			c.JSON(http.StatusNotFound, errs.NotFound.WithMsg("subscription not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg("failed to delete subscription"))
		return
	}

	h.sourceSvc.RemoveSubCron(id)
	c.JSON(http.StatusOK, gin.H{"message": "subscription deleted"})
}

// SyncSubscription triggers a sync for a single subscription.
// SyncSubscription 触发单个订阅同步.
func (h *Handler) SyncSubscription(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, errs.InvalidID.WithMsg("invalid subscription id"))
		return
	}

	if err := h.sourceSvc.SyncSubscription(id); err != nil {
		c.JSON(http.StatusInternalServerError, errs.ServerError.WithMsg(err.Error()))
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "subscription synced"})
}
